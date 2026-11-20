const { chromium } = require('playwright');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const vaultManager = require('./vaultManager');
const browserBridge = require('./browserBridge');

class AutoLoginEngine extends EventEmitter {
  constructor() {
    super();
    this.activeChallenges = new Map(); // platform -> { page, context, resolve, timeout }
  }

  /**
   * Executes autonomous silent background login for a given platform (e.g. 'linkedin')
   */
  async login(platform, credentials = {}) {
    const plat = (platform || 'linkedin').toLowerCase().trim();
    let email = credentials.email;
    let password = credentials.password;

    // Load from vault if not supplied
    if (!email || !password) {
      const saved = vaultManager.getPlatformCredentials(plat);
      if (saved) {
        email = email || saved.email;
        password = password || saved.password;
      }
    }

    if (!email || !password) {
      return {
        status: 'missing_credentials',
        message: `Please provide your ${plat.toUpperCase()} email and password to auto-login.`
      };
    }

    // Persist credentials in secure vault for future autonomous runs
    try {
      vaultManager.savePlatformCredentials(plat, { email, password });
    } catch (_) {}

    if (plat === 'linkedin') {
      return await this.loginLinkedIn(email, password);
    } else {
      return { status: 'unsupported', message: `Platform ${platform} auto-login is not implemented.` };
    }
  }

  /**
   * Autonomous silent login for LinkedIn
   */
  async loginLinkedIn(email, password) {
    let page;
    try {
      // Connect to the active browser instance via CDP
      page = await browserBridge.getPage();
    } catch (err) {
      return { status: 'error', message: `Failed to initialize background browser: ${err.message}` };
    }

    try {
      // 1. Check if already logged in
      const alreadyLogged = await browserBridge.isLinkedInLoggedIn();
      if (alreadyLogged) {
        this.markVerified('linkedin', true);
        return {
          status: 'success',
          message: '✓ Already securely logged in to LinkedIn!'
        };
      }

      // 2. Navigate to LinkedIn login page if not already there
      this.emit('log', { text: '🌐 [Auto-Login] Accessing LinkedIn secure login gateway...', type: 'info' });
      if (!page.url().includes('linkedin.com/login')) {
        await page.goto('https://www.linkedin.com/login', {
          waitUntil: 'domcontentloaded',
          timeout: 25000
        }).catch(() => {});
      }
      await page.waitForTimeout(1500);

      // Re-verify if cookies auto-restored
      if (await browserBridge.isLinkedInLoggedIn()) {
        this.markVerified('linkedin', true);
        return { status: 'success', message: '✓ LinkedIn session authenticated via cookies!' };
      }

      // Check if Cloudflare or security challenge is blocking the login form
      const isSecurityCheck = await page.evaluate(() => {
        const title = document.title || '';
        const text = document.body ? document.body.innerText : '';
        return title.includes('Just a moment') || text.includes('security verification') || text.includes('malicious bots') || Boolean(document.querySelector('iframe[src*="turnstile"], iframe[src*="challenge"]'));
      });

      if (isSecurityCheck) {
        this.emit('log', { text: '🛡️ Cloudflare security verification ("Verify you are human") detected on LinkedIn gateway.', type: 'warn' });
        return {
          status: 'bot_check_required',
          message: 'LinkedIn presented a Cloudflare security challenge ("Verify you are human"). Please complete the checkbox in the open Chrome window.'
        };
      }

      // 3. Fill in email/username (specifically selecting the visible input)
      this.emit('log', { text: `🔑 [Auto-Login] Inputting credentials for ${email}...`, type: 'info' });
      const emailSelector = 'input[type="email"], input[autocomplete*="username"], input#username, input#session_key, input[name="session_key"]';
      await this.fillVisibleInput(page, emailSelector, email.trim());

      // 4. Fill in password (specifically selecting the visible input)
      const passSelector = 'input[type="password"], input[autocomplete*="password"], input#password, input#session_password, input[name="session_password"]';
      await this.fillVisibleInput(page, passSelector, password);

      // 5. Click Sign In
      await this.clickVisibleSubmit(page);
      await page.waitForTimeout(4000);

      // 6. State Classification
      return await this.classifyLinkedInLoginState(page);

    } catch (err) {
      return {
        status: 'error',
        message: `Auto-login execution failed: ${err.message}`
      };
    }
  }

  /**
   * Helper: Fills the first truly visible input among matching elements (width > 0, height > 0)
   */
  async fillVisibleInput(page, selectors, value) {
    // 1. Direct DOM execution: find the visible input and dispatch events
    const filled = await page.evaluate(({ selectors, value }) => {
      const inputs = Array.from(document.querySelectorAll(selectors));
      const target = inputs.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden' && window.getComputedStyle(el).display !== 'none';
      });
      if (target) {
        target.focus();
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, { selectors, value });

    if (filled) return true;

    // 2. Playwright locators fallback: search for visible element
    const locator = page.locator(selectors);
    const count = await locator.count();
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);
      const isVis = await el.isVisible().catch(() => false);
      if (isVis) {
        await el.click().catch(() => {});
        await el.fill(value).catch(() => {});
        return true;
      }
    }

    if (count === 0) {
      const pageTitle = await page.title().catch(() => '');
      throw new Error(`Login form input was not found on the page (Page Title: "${pageTitle}").`);
    }

    // 3. Fallback force fill
    await locator.first().fill(value, { force: true, timeout: 5000 });
    return true;
  }

  /**
   * Helper: Clicks the first truly visible submit button
   */
  async clickVisibleSubmit(page) {
    const clicked = await page.evaluate(() => {
      // 1. Direct submit button inside login form or with LinkedIn login-submit URN
      const formBtn = document.querySelector('form.login__form button[type="submit"], form button[data-litms-control-urn*="login-submit"], button[data-litms-control-urn*="login-submit"]');
      if (formBtn) {
        const rect = formBtn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          formBtn.focus();
          formBtn.click();
          return true;
        }
      }

      // 2. Candidate scan excluding Google/Microsoft/Apple SSO buttons
      const candidates = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], form button'));
      const target = candidates.find(b => {
        const text = (b.innerText || b.textContent || b.value || '').toLowerCase();
        const type = (b.type || '').toLowerCase();
        const isThirdParty = /google|microsoft|apple/i.test(text);
        if (isThirdParty) return false;
        const isSubmit = type === 'submit' || /^(sign in|log in|agree & join|submit)$/i.test(text.trim());
        if (!isSubmit) return false;
        const rect = b.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(b).display !== 'none' && window.getComputedStyle(b).visibility !== 'hidden';
      });

      if (target) {
        target.focus();
        target.click();
        return true;
      }
      return false;
    });

    if (clicked) return true;

    // Playwright fallback strictly excluding SSO
    const loc = page.locator('form.login__form button[type="submit"], button[data-litms-control-urn*="login-submit"], button[type="submit"]:not(:has-text("Google")):not(:has-text("Microsoft")):not(:has-text("Apple"))');
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        return true;
      }
    }
    return false;
  }

  /**
   * Classify the result of LinkedIn login (Success, Bad Credentials, or 2FA Checkpoint)
   */
  async classifyLinkedInLoginState(page) {
    const currentUrl = page.url() || '';

    // A. Check for Success
    const isLogged = await browserBridge.isLinkedInLoggedIn();
    if (isLogged || currentUrl.includes('/feed') || currentUrl.includes('/jobs') || currentUrl.includes('/in/')) {
      this.markVerified('linkedin', true);
      this.emit('log', { text: '✓ [Auto-Login] Authentication SUCCESS! LinkedIn session verified.', type: 'success' });
      return {
        status: 'success',
        message: '✓ Authentication successful! LinkedIn is now verified and active.'
      };
    }

    // B. Check for Bad Credentials
    const errorText = await page.evaluate(() => {
      const el = document.querySelector('#error-for-username, #error-for-password, .alert--error, .form__label--error, [alert-for], [role="alert"]');
      return el ? (el.innerText || el.textContent || '').trim() : '';
    });

    if (errorText && (
      /password|username|account|email|incorrect|wrong|try again/i.test(errorText) ||
      currentUrl.includes('/login-submit')
    )) {
      this.markVerified('linkedin', false);
      this.emit('log', { text: `❌ [Auto-Login] Invalid credentials: "${errorText || 'Authentication rejected'}"`, type: 'error' });
      return {
        status: 'bad_credentials',
        message: errorText || 'Invalid LinkedIn email or password. Please verify your credentials and try again.'
      };
    }

    // C. Check for Two-Factor / Verification Code Challenge (PIN / OTP)
    const isChallenge = currentUrl.includes('/checkpoint/challenge') ||
                        currentUrl.includes('/checkpoint/lg') ||
                        (await page.$('input#input__email_verification_pin, input[name="pin"], input[type="tel"], input[name*="code" i], #email-pin-submit-button'));

    if (isChallenge) {
      this.emit('log', { text: '🔐 [Auto-Login] Verification code required by LinkedIn (2FA / Security PIN).', type: 'warn' });
      
      // Extract prompt message if present
      const promptDesc = await page.evaluate(() => {
        const p = document.querySelector('.header__content, #challenge-sub-header, h1, h2, p');
        return p ? p.innerText.trim() : '';
      }) || 'LinkedIn sent a verification code to your email or phone.';

      // Register active challenge so user can submit code via API
      this.registerChallenge('linkedin', page);

      return {
        status: 'challenge_required',
        platform: 'linkedin',
        challengeType: '2fa_code',
        message: promptDesc
      };
    }

    // D. Generic Checkpoint or CAPTCHA
    if (currentUrl.includes('checkpoint')) {
      return {
        status: 'captcha_required',
        message: 'LinkedIn presented a security puzzle/CAPTCHA. Please review the live browser preview.'
      };
    }

    // Fallback: If still on login page
    if (currentUrl.includes('/login')) {
      return {
        status: 'bad_credentials',
        message: 'Unable to sign in. Please verify your email and password.'
      };
    }

    return {
      status: 'pending',
      message: 'Processing login... please check status.'
    };
  }

  /**
   * Holds an open browser page waiting for the user to submit their 2FA / OTP code
   */
  registerChallenge(platform, page) {
    if (this.activeChallenges.has(platform)) {
      const old = this.activeChallenges.get(platform);
      clearTimeout(old.timeout);
    }

    // Auto-expire after 5 minutes if user doesn't respond
    const timeout = setTimeout(() => {
      this.activeChallenges.delete(platform);
      this.emit('log', { text: `⌛ 2FA challenge for ${platform} expired after 5 minutes.`, type: 'warn' });
    }, 5 * 60 * 1000);

    this.activeChallenges.set(platform, { page, timeout });
    this.emit('challenge_created', { platform });
  }

  /**
   * Autonomous injection of verification code submitted by user in dashboard
   */
  async submitChallengeCode(platform, code) {
    const plat = (platform || 'linkedin').toLowerCase().trim();
    const challenge = this.activeChallenges.get(plat);

    if (!challenge || !challenge.page || challenge.page.isClosed()) {
      return {
        status: 'no_active_challenge',
        message: 'No active verification code prompt is waiting. Please click Auto-Login again.'
      };
    }

    const { page, timeout } = challenge;
    clearTimeout(timeout);

    try {
      this.emit('log', { text: `🔑 [Auto-Login] Submitting verification code (${code.length} digits)...`, type: 'info' });

      // Detect code/PIN input selector
      const codeSelector = 'input#input__email_verification_pin, input[name="pin"], input[type="tel"], input[name*="code" i], input[id*="code" i]';
      await this.fillVisibleInput(page, codeSelector, String(code).trim());

      // Submit the code
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        this.clickVisibleSubmit(page)
      ]);

      await page.waitForTimeout(2500);

      // Verify success
      const isLogged = await browserBridge.isLinkedInLoggedIn();
      const currentUrl = page.url() || '';

      if (isLogged || currentUrl.includes('/feed') || currentUrl.includes('/jobs') || currentUrl.includes('/in/')) {
        this.activeChallenges.delete(plat);
        this.markVerified(plat, true);
        this.emit('log', { text: '✓ [Auto-Login] 2FA verification SUCCESS! Session active.', type: 'success' });
        return {
          status: 'success',
          message: '✓ Verification code accepted! LinkedIn is now fully authenticated.'
        };
      }

      // Check for code rejection
      const hasError = await page.$('.form__label--error, .alert--error, [role="alert"]');
      if (hasError) {
        // Re-register so user can try code again
        this.registerChallenge(plat, page);
        return {
          status: 'bad_code',
          message: 'The verification code entered was incorrect or expired. Please check and re-enter.'
        };
      }

      this.activeChallenges.delete(plat);
      return {
        status: 'success',
        message: '✓ Code submitted. Checking session status...'
      };

    } catch (err) {
      return {
        status: 'error',
        message: `Failed to submit verification code: ${err.message}`
      };
    }
  }

  markVerified(platform, status = true) {
    try {
      const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!s.auth) s.auth = {};
        s.auth[platform] = status;
        fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
      }
    } catch (_) {}
  }
}

module.exports = new AutoLoginEngine();
