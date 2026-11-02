const path = require('path');
const fs = require('fs');
const questionEngine = require('./questionEngine');
const pdfRenderer = require('./pdfRenderer');
const eligibilityEngine = require('./eligibilityEngine');
const vaultManager = require('./vaultManager');
const tracker = require('./tracker');

class ExternalApplyEngine {
  constructor(browserBridge) {
    this.bridge = browserBridge;
    this.authToggleCount = 0;
  }

  /**
   * Helper logger
   */
  log(updateCb, msg) {
    if (typeof updateCb === 'function') updateCb(msg);
    console.log(`[ExternalApply] ${msg}`);
  }

  /**
   * Safe Ledger Recorder with Dry-Run Interceptor:
   * Suppresses writing APPLIED, COOLDOWN, or HOLD outcomes to applications.json during dry-run inspections.
   */
  recordOutcome(jobInfo, status, metadata = {}, options = {}) {
    const isDryRun = options.dryRun === true || options.settings?.execution?.dryRun === true || process.argv.includes('--dry-run');
    if (isDryRun) {
      this.log(null, `🧪 [DRY-RUN] Suppressed recording outcome "${status}" to applications.json ledger.`);
      return { dryRun: true, status, metadata };
    }
    return this.recordOutcome(jobInfo, status, metadata, options);
  }

  /**
   * Normalize ATS links to point directly to application form
   */
  normalizeAtsUrl(url) {
    if (!url || typeof url !== 'string') return url;
    let clean = url.trim();
    if (clean.includes('jobs.ashbyhq.com') && !clean.includes('/application')) {
      clean = `${clean.replace(/\/+$/, '')}/application`;
    } else if (clean.includes('jobs.lever.co') && !clean.includes('/apply')) {
      clean = `${clean.replace(/\/+$/, '')}/apply`;
    } else if (clean.includes('boards.greenhouse.io') && !clean.includes('#app')) {
      clean = clean.replace(/#.*$/, '') + '#app';
    }
    return clean;
  }

  /**
   * Global Interceptor: Auto-dismiss Cookie and GDPR overlays
   */
  async dismissCookieOverlays(page) {
    if (!page || page.isClosed()) return;
    try {
      const dismissSelectors = [
        '#onetrust-accept-btn-handler',
        'button:has-text("Accept All Cookies")',
        'button:has-text("Accept All")',
        'button:has-text("Accept all")',
        'button:has-text("I Agree")',
        'button:has-text("Got it")',
        'button:has-text("Allow all")',
        'button:has-text("Allow All")',
        'a:has-text("Accept All Cookies")',
        '.cookie-consent-accept',
        '[aria-label="Accept cookies"]'
      ];
      for (const sel of dismissSelectors) {
        const btn = await page.$(sel).catch(() => null);
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 1500 }).catch(() => {});
          await this.bridge.humanDelay(200, 400);
          break;
        }
      }
    } catch (_) {}
  }

  /**
   * Universal Check: Detect interactive/blocking CAPTCHA challenge in DOM
   */
  async isInteractiveCaptchaVisible(page) {
    if (!page || page.isClosed()) return false;
    try {
      const blockingSelectors = [
        'iframe[src*="recaptcha/api2/bframe"]',
        'iframe[src*="recaptcha/enterprise/bframe"]',
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[src*="hcaptcha.com/box"]',
        'iframe[title*="recaptcha challenge"]',
        'iframe[title*="hCaptcha security challenge"]',
        'div.cf-turnstile-wrapper:has(iframe)',
        'div.g-recaptcha[data-size!="invisible"]',
        'div:has-text("Please verify you are a human")',
        'div:has-text("Press & Hold")'
      ];
      for (const sel of blockingSelectors) {
        const el = await page.$(sel).catch(() => null);
        if (el && await el.isVisible().catch(() => false)) {
          return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Universal Check: Are application form fields (Name, Email, Resume Upload) directly open?
   * Used by Greenhouse, Lever, Ashby, BambooHR
   */
  async areFormFieldsDirectlyOpen(page) {
    if (!page || page.isClosed()) return false;
    try {
      const hasFileInput = (await page.$('div[data-automation-id="file-upload-drop-zone"] input[type="file"], input[type="file"]').catch(() => null)) !== null;
      const hasNameInput = (await page.$('input[data-automation-id*="firstName"], input[name*="name" i], input[id*="name" i], input[placeholder*="name" i]').catch(() => null)) !== null;
      const hasEmailInput = (await page.$('input[data-automation-id="email"], input[type="email"], input[name*="email" i], input[id*="email" i]').catch(() => null)) !== null;
      const hasWorkdayWizard = (await page.$('[data-automation-id="bottom-navigation-next-button"], [data-automation-id="bottom-navigation-submit-button"]').catch(() => null)) !== null;
      return (hasFileInput && (hasNameInput || hasEmailInput)) || hasWorkdayWizard;
    } catch (_) {
      return false;
    }
  }

  /**
   * Main Entrypoint: Stage 1 to 4 Pipeline
   */
  async handleExternalApply(linkedInPage, jobInfo, options = {}) {
    const update = (msg) => this.log(options.onStatusUpdate, msg);
    this.authToggleCount = 0;

    // ==========================================
    // STAGE 1: ENTRY AND ROUTING
    // ==========================================
    update(`🌐 [Stage 1] Pre-Flight Ledger Audit for: "${jobInfo.title}" at "${jobInfo.company}"...`);
    const preFlight = tracker.evaluatePreFlightClass(jobInfo);

    if (preFlight.action === 'SKIP') {
      if (preFlight.class === 'DONE') {
        update(`⏭️ Pre-flight: Already applied within 90d. Skipping.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_ALREADY_APPLIED', reason: 'Already applied' };
      }
      if (preFlight.class === 'HOLD') {
        update(`⏸️ Pre-flight: Job on HOLD (${preFlight.reason}). Awaiting candidate clearance.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_HOLD_PENDING_USER', reason: preFlight.reason };
      }
      if (preFlight.class === 'COOLDOWN') {
        update(`⏳ Pre-flight: Job in COOLDOWN (${preFlight.daysLeft || 7}d remaining, attempts: ${preFlight.attemptsCount}). Skipping.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_COOLDOWN', reason: preFlight.reason };
      }
    }

    const context = linkedInPage.context();
    let externalPage = null;

    try {
      // 1. Locate and click external apply button on LinkedIn
      const applyBtn = await this.findApplyButton(linkedInPage);
      if (!applyBtn) {
        this.recordOutcome(jobInfo, 'FAILED_PORTAL_UNREACHABLE', { code: 'CODE_NO_APPLY_BUTTON', message: 'No apply button on LinkedIn' }, options);
        return { status: 'failed', code: 'CODE_NO_APPLY_BUTTON', message: 'No external Apply button found on LinkedIn.' };
      }

      const directHref = await applyBtn.getAttribute('href').catch(() => null);
      const newPagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);

      await applyBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(1500, 2500);
      await this.handleLinkedInRedirectModal(linkedInPage, update);

      externalPage = await newPagePromise;
      if (!externalPage && directHref && !directHref.startsWith('#')) {
        update(`Opening direct career URL in new tab...`);
        externalPage = await context.newPage();
        await externalPage.goto(directHref, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }

      if (!externalPage) {
        const currentUrl = linkedInPage.url();
        if (!currentUrl.includes('linkedin.com/jobs')) {
          externalPage = linkedInPage;
        } else {
          this.recordOutcome(jobInfo, 'FAILED_PORTAL_UNREACHABLE', { code: 'CODE_PORTAL_UNREACHABLE', message: 'Could not capture external tab' }, options);
          return { status: 'failed', code: 'CODE_PORTAL_UNREACHABLE', message: 'Could not capture external tab.' };
        }
      }

      await externalPage.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(() => {});
      await this.bridge.humanDelay(1500, 2500);
      await this.dismissCookieOverlays(externalPage);

      const targetUrl = externalPage.url();
      jobInfo.url = targetUrl;
      update(`✓ External career page loaded: ${targetUrl.slice(0, 80)}...`);

      // Check if Job Description page with internal "Apply" button
      const isDirectForm = await this.areFormFieldsDirectlyOpen(externalPage);
      if (!isDirectForm) {
        const internalApplyBtn = await externalPage.$(
          'a[data-automation-id="adventureButton"], button[data-automation-id="adventureButton"], a:has-text("Apply for this job"), a:has-text("Apply Now"), button:has-text("Apply for this job"), button:has-text("Apply Now"), a:has-text("Apply"), button:has-text("Apply")'
        ).catch(() => null);

        if (internalApplyBtn && await internalApplyBtn.isVisible().catch(() => false)) {
          update('Clicking internal career page "Apply Now" button...');
          await internalApplyBtn.click({ force: true }).catch(() => {});
          await this.bridge.humanDelay(2000, 3500);
          await this.dismissCookieOverlays(externalPage);

          // Workday sub-options check: "Autofill with Resume" or "Apply Manually"
          const wdAutofill = await externalPage.$('a[data-automation-id="autofillWithResume"], [data-automation-id="applyWithResume"], a:has-text("Autofill with Resume")').catch(() => null);
          const wdManual = await externalPage.$('a[data-automation-id="applyManually"], a:has-text("Apply Manually")').catch(() => null);
          if (wdAutofill && await wdAutofill.isVisible().catch(() => false)) {
            update('Selecting Workday "Autofill with Resume"...');
            await wdAutofill.click({ force: true }).catch(() => {});
            await this.bridge.humanDelay(2000, 3500);
          } else if (wdManual && await wdManual.isVisible().catch(() => false)) {
            update('Selecting Workday "Apply Manually"...');
            await wdManual.click({ force: true }).catch(() => {});
            await this.bridge.humanDelay(2000, 3500);
          }
        }
      }

      // Check if reachable
      const pageTitle = await externalPage.title().catch(() => '');
      if (pageTitle.includes('404') || pageTitle.includes('Not Found') || pageTitle.includes('Page Unavailable')) {
        this.recordOutcome(jobInfo, 'FAILED_PORTAL_UNREACHABLE', { code: 'CODE_PORTAL_UNREACHABLE', message: 'Portal returned 404' }, options);
        return { status: 'failed', code: 'CODE_PORTAL_UNREACHABLE', message: 'Portal returned 404.' };
      }

      // Interactive CAPTCHA check on Landing
      if (await this.isInteractiveCaptchaVisible(externalPage)) {
        update('🛑 Interactive CAPTCHA Challenge detected on landing. Recording cooldown exit.');
        this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'landing', code: 'CODE_CAPTCHA_INTERACTIVE_BLOCK' }, options);
        return { status: 'blocked', code: 'CODE_CAPTCHA_INTERACTIVE_BLOCK', stage: 'landing' };
      }

      // FAST PATH: Direct Open ATS (Greenhouse, Lever, Ashby)
      if (await this.areFormFieldsDirectlyOpen(externalPage)) {
        update('⚡ Direct Open ATS detected (Greenhouse/Lever/Ashby). Bypassing auth straight to Stage 3!');
        return await this.executeStage3And4(externalPage, jobInfo, update, options);
      }

      // Check Guest Apply
      const guestBtn = await externalPage.$(
        'button:has-text("Apply as Guest"), a:has-text("Apply as Guest"), button:has-text("Apply without Account"), a:has-text("Apply without Account"), button:has-text("Quick Apply")'
      ).catch(() => null);

      if (guestBtn && await guestBtn.isVisible().catch(() => false)) {
        update('✓ "Apply as Guest" option available. Clicking guest apply...');
        await guestBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(2000, 3500);
        await this.dismissCookieOverlays(externalPage);

        const guestFormLoaded = await this.areFormFieldsDirectlyOpen(externalPage);
        if (!guestFormLoaded) {
          this.recordOutcome(jobInfo, 'FAILED_GUEST_APPLY_LOAD', { code: 'CODE_GUEST_APPLY_FAILED', message: 'Guest form failed to load' }, options);
          return { status: 'failed', code: 'CODE_GUEST_APPLY_FAILED', message: 'Guest form failed to load.' };
        }
        return await this.executeStage3And4(externalPage, jobInfo, update, options);
      }

      // ==========================================
      // STAGE 2: AUTH AND 2FA
      // ==========================================
      update('🔐 [Stage 2] Authentication Gate Encountered. Classifying auth modalities...');
      const authResult = await this.executeStage2Auth(externalPage, jobInfo, update, options);
      if (authResult.status !== 'authenticated') {
        return authResult;
      }

      // Once Auth + 2FA cleared, execute Stage 3 and 4
      return await this.executeStage3And4(externalPage, jobInfo, update, options);

    } catch (err) {
      update(`❌ External Apply Pipeline Exception: ${err.message}`);
      this.recordOutcome(jobInfo, 'FAILED_PORTAL_UNREACHABLE', { code: 'CODE_PIPELINE_EXCEPTION', message: err.message }, options);
      return { status: 'failed', code: 'CODE_PIPELINE_EXCEPTION', message: err.message };
    }
  }

  /**
   * Stage 2: Authentication, Vault 2PC, Social OAuth & 2FA
   */
  async executeStage2Auth(page, jobInfo, update, options) {
    const targetUrl = (page.url() && page.url() !== 'about:blank') ? page.url() : (jobInfo.url || '');
    const tenantOrigin = vaultManager.getTenantKey(targetUrl);

    // 1. Check for Enterprise SSO / SAML only
    const isSSOOnly = (await page.$('a:has-text("Company Single Sign-On"), button:has-text("Sign in with SSO"), a:has-text("Sign in with SSO")').catch(() => null)) !== null &&
                      (await page.$('input[type="password"]').catch(() => null)) === null;
    if (isSSOOnly) {
      update('🏢 Enterprise SSO/SAML-only portal detected. Queued for candidate manual login.');
      this.recordOutcome(jobInfo, 'BLOCKED_SSO_ONLY', { code: 'CODE_AUTH_SSO_SAML_ONLY' }, options);
      return { status: 'blocked', code: 'CODE_AUTH_SSO_SAML_ONLY', tenant: tenantOrigin };
    }

    // 2. Check for Social OAuth (LinkedIn / Google)
    const oauthBtn = await page.$(
      'button:has-text("Apply with LinkedIn"), a:has-text("Apply with LinkedIn"), button:has-text("Sign in with LinkedIn"), button:has-text("Sign in with Google")'
    ).catch(() => null);

    if (oauthBtn && await oauthBtn.isVisible().catch(() => false)) {
      update('🔗 Social OAuth detected. Attempting 1-click active session handshake...');
      const popupPromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
      await oauthBtn.click({ force: true }).catch(() => {});
      const oauthPopup = await popupPromise;
      if (oauthPopup) {
        await this.bridge.humanDelay(3000, 5000);
        await oauthPopup.close().catch(() => {});
      }
      await this.bridge.humanDelay(2000, 3500);

      const hasPasswordForm = (await page.$('input[type="password"]').catch(() => null)) !== null;
      const isAuthCleared = !(await page.$('button:has-text("Sign in with LinkedIn"), button:has-text("Log In")').catch(() => null));
      if (!isAuthCleared && !hasPasswordForm) {
        this.recordOutcome(jobInfo, 'FAILED_OAUTH_NO_FALLBACK', { code: 'CODE_OAUTH_FAILED_NO_FALLBACK' }, options);
        return { status: 'failed', code: 'CODE_OAUTH_FAILED_NO_FALLBACK' };
      }
    }

    // 3. Vault Credentials Query for Tenant
    const creds = vaultManager.getCredentials(targetUrl);
    const hasPasswordForm = (await page.$('input[type="password"]').catch(() => null)) !== null;

    if (creds && creds.status === 'ACTIVE_CREDENTIAL' && hasPasswordForm) {
      update(`🔑 Found active encrypted credentials for tenant "${tenantOrigin}". Decrypting and signing in...`);
      await this.safeType(page, 'input[data-automation-id="email"], input[type="email"], input[name*="user" i], input[name*="email" i]', creds.email);
      await this.safeType(page, 'input[data-automation-id="password"], input[type="password"]', creds.password);

      const signInBtn = await page.$('button[data-automation-id="signInSubmitButton"], button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
      if (signInBtn) await signInBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(3000, 4500);

      // Post Sign-in CAPTCHA
      if (await this.isInteractiveCaptchaVisible(page)) {
        this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'signin', code: 'CODE_CAPTCHA_SIGNIN_BLOCK' }, options);
        return { status: 'blocked', code: 'CODE_CAPTCHA_SIGNIN_BLOCK', stage: 'signin' };
      }

      // Check if sign-in failed
      const hasBadCredsError = (await page.$('div:has-text("Invalid user name or password"), div:has-text("Account locked"), div:has-text("Incorrect email or password")').catch(() => null)) !== null;
      if (hasBadCredsError) {
        this.recordOutcome(jobInfo, 'FAILED_CREDENTIALS_REJECTED', { code: 'CODE_VAULT_CREDENTIALS_REJECTED' }, options);
        return { status: 'failed', code: 'CODE_VAULT_CREDENTIALS_REJECTED' };
      }
    } else if (hasPasswordForm) {
      // Registration with Two-Phase Commit (2PC)
      const candidateEmail = this.getCandidateEmail();
      const compliantPassword = vaultManager.generateCompliantPassword();

      update(`📝 No credentials in vault for "${tenantOrigin}". Phase 1 (2PC): Writing PENDING credentials to encrypted vault...`);
      vaultManager.savePendingCredentials(targetUrl, { email: candidateEmail, password: compliantPassword });

      const createAccTab = await page.$('a[data-automation-id="createAccountLink"], a:has-text("Create Account"), button:has-text("Create Account"), a:has-text("Register"), button:has-text("Register")');
      if (createAccTab) {
        await createAccTab.click().catch(() => {});
        await this.bridge.humanDelay(1500, 2500);
      }

      await this.safeType(page, 'input[data-automation-id="email"], input[type="email"], input[name*="email" i]', candidateEmail);
      const pwds = await page.$$('input[type="password"]');
      for (const pInput of pwds) {
        await pInput.fill(compliantPassword).catch(() => {});
        await this.bridge.humanDelay(150, 250);
      }

      // Accept terms checkboxes
      const termsCheck = await page.$('input[data-automation-id="createAccountCheckbox"], input[type="checkbox"]');
      if (termsCheck && !(await termsCheck.isChecked().catch(() => true))) {
        await termsCheck.check().catch(() => {});
      }

      const regSubmit = await page.$('button[data-automation-id="createAccountSubmitButton"], button[type="submit"], input[type="submit"], button:has-text("Create Account"), button:has-text("Register")');
      if (regSubmit) await regSubmit.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(3000, 5000);

      // Post Register CAPTCHA
      if (await this.isInteractiveCaptchaVisible(page)) {
        this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'register', code: 'CODE_CAPTCHA_REGISTER_BLOCK' }, options);
        return { status: 'blocked', code: 'CODE_CAPTCHA_REGISTER_BLOCK', stage: 'register' };
      }

      // Check if registration succeeded or email already registered
      const emailExists = (await page.$('div:has-text("already exists"), div:has-text("already registered"), div:has-text("account with this email")').catch(() => null)) !== null;
      if (emailExists) {
        update('⚠️ Email already registered on portal. Attempting Master Password Sign-In...');
        const masterPwd = this.getMasterPassword();
        if (masterPwd) {
          const loginTab = await page.$('a:has-text("Sign In"), button:has-text("Sign In"), a:has-text("Log In")');
          if (loginTab) await loginTab.click().catch(() => {});
          await this.bridge.humanDelay(1500, 2500);

          await this.safeType(page, 'input[type="email"], input[name*="email" i]', candidateEmail);
          await this.safeType(page, 'input[type="password"]', masterPwd);
          const sBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign In")');
          if (sBtn) await sBtn.click({ force: true }).catch(() => {});
          await this.bridge.humanDelay(3000, 4500);

          if (await this.isInteractiveCaptchaVisible(page)) {
            this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'master', code: 'CODE_CAPTCHA_MASTER_BLOCK' }, options);
            return { status: 'blocked', code: 'CODE_CAPTCHA_MASTER_BLOCK', stage: 'master' };
          }

          const masterSuccess = (await page.$('div:has-text("Invalid user name or password")').catch(() => null)) === null;
          if (masterSuccess) {
            update('✓ Master password authenticated successfully. Phase 2 (2PC): Committing credentials to vault.');
            vaultManager.savePendingCredentials(targetUrl, { email: candidateEmail, password: masterPwd });
            vaultManager.commitCredentials(targetUrl);
          } else {
            this.recordOutcome(jobInfo, 'FAILED_MASTER_PASSWORD_REJECTED', { code: 'CODE_MASTER_PASSWORD_REJECTED' }, options);
            return { status: 'failed', code: 'CODE_MASTER_PASSWORD_REJECTED' };
          }
        } else {
          this.recordOutcome(jobInfo, 'FAILED_REG_POLICY', { code: 'CODE_ACCOUNT_EXISTS_NO_CREDENTIALS' }, options);
          return { status: 'failed', code: 'CODE_ACCOUNT_EXISTS_NO_CREDENTIALS' };
        }
      } else {
        update('✓ Registration submitted. Phase 2 (2PC): Committing credentials to vault.');
        vaultManager.commitCredentials(targetUrl);
      }

      // Check Post-Reg Activation Barrier
      const activationRequired = (await page.$('div:has-text("activate your account"), div:has-text("verify your email"), div:has-text("verification link sent")').catch(() => null)) !== null;
      if (activationRequired) {
        update('📧 Email activation barrier active. Queued for candidate verification.');
        this.recordOutcome(jobInfo, 'BLOCKED_ACTIVATION_PENDING', { code: 'CODE_EMAIL_ACTIVATION_REQUIRED' }, options);
        return { status: 'blocked', code: 'CODE_EMAIL_ACTIVATION_REQUIRED' };
      }
    }

    // 4. Handle 2FA Screen if Present
    const has2FAScreen = (await page.$('input[name*="otp" i], input[name*="code" i], input[id*="otp" i], div:has-text("Enter verification code"), div:has-text("Two-Factor Authentication")').catch(() => null)) !== null;
    if (has2FAScreen) {
      update('🛡️ 2FA Challenge detected on screen. Resolving 2FA modality...');
      const twoFaResult = await this.resolve2FA(page, targetUrl, update);
      if (twoFaResult.status !== 'verified') {
        this.recordOutcome(jobInfo, twoFaResult.code, { code: twoFaResult.code, message: twoFaResult.message }, options);
        return twoFaResult;
      }
    }

    // 5. Post-Auth Landing: Ensure application form is reachable
    const formReachable = await this.areFormFieldsDirectlyOpen(page);
    if (!formReachable) {
      update('Locating application form post-authentication...');
      const returnBtn = await page.$('a:has-text("Apply for this Job"), button:has-text("Apply for this Job"), a:has-text("Complete Application"), a:has-text("Start Application")');
      if (returnBtn && await returnBtn.isVisible().catch(() => false)) {
        await returnBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(2000, 3500);
      }
      if (!await this.areFormFieldsDirectlyOpen(page)) {
        this.recordOutcome(jobInfo, 'FAILED_POST_AUTH_FORM_LOST', { code: 'CODE_POST_AUTH_FORM_NOT_FOUND' }, options);
        return { status: 'failed', code: 'CODE_POST_AUTH_FORM_NOT_FOUND' };
      }
    }

    return { status: 'authenticated' };
  }

  /**
   * Resolve 2FA modality: TOTP, SMS/Email OTP, or Push/Magic Link
   */
  async resolve2FA(page, url, update) {
    const isTotp = (await page.$('div:has-text("Authenticator app"), div:has-text("TOTP")').catch(() => null)) !== null;
    const isPush = (await page.$('div:has-text("Approve the notification"), div:has-text("Check your mobile device")').catch(() => null)) !== null;

    if (isTotp) {
      const creds = vaultManager.getCredentials(url);
      if (creds && creds.totpSecret) {
        const token = vaultManager.generateTOTP(creds.totpSecret);
        if (token) {
          update(`✓ Computed RFC-6238 TOTP (${token}). Auto-injecting...`);
          await this.safeType(page, 'input[name*="code" i], input[name*="otp" i]', token);
          const verifyBtn = await page.$('button:has-text("Verify"), button:has-text("Submit"), input[type="submit"]');
          if (verifyBtn) await verifyBtn.click().catch(() => {});
          await this.bridge.humanDelay(2000, 3500);
          return { status: 'verified' };
        }
      }
    }

    if (isPush) {
      update('📱 Push approval triggered. Waiting for device approval (max 120s)...');
      const start = Date.now();
      while (Date.now() - start < 120000) {
        await this.bridge.humanDelay(2500, 3500);
        const spinnerDetached = !(await page.$('div.spinner, div[aria-label="Loading"]').catch(() => null));
        if (spinnerDetached && await this.areFormFieldsDirectlyOpen(page)) {
          return { status: 'verified' };
        }
      }
      return { status: 'failed', code: 'TIMEOUT_2FA', message: 'Push approval timed out after 120s' };
    }

    // Default: Alert user for 6-digit OTP code (120s window)
    update('🔔 ALERT: 2FA Verification code requested. Enter code in open Chrome tab (120s window)...');
    const start = Date.now();
    while (Date.now() - start < 120000) {
      await this.bridge.humanDelay(2000, 3000);
      const isCleared = !(await page.$('input[name*="otp" i], input[name*="code" i]').catch(() => null));
      if (isCleared || await this.areFormFieldsDirectlyOpen(page)) {
        return { status: 'verified' };
      }
    }
    return { status: 'failed', code: 'TIMEOUT_2FA', message: 'User OTP entry timed out after 120s' };
  }

  /**
   * Stage 3 & 4: Upload Resume First -> Multi-Step Wizard Engine -> Final Submit & Audit
   */
  async executeStage3And4(page, jobInfo, update, options) {
    // ==========================================
    // STAGE 3: UPLOAD AND WIZARD
    // ==========================================
    update('📄 [Stage 3] Synthesizing job-tailored ATS CV vector PDF...');
    let tailoredCV = null;
    try {
      tailoredCV = await pdfRenderer.renderTailoredCV(jobInfo);
      jobInfo.tailoredCV = tailoredCV.fileName;
      update(`✓ Tailored CV ready: ${tailoredCV.fileName} (${Math.round(tailoredCV.fileSize / 1024)} KB)`);
    } catch (e) {
      update(`⚠️ CV generator note: ${e.message}`);
    }

    // Upload Resume FIRST to trigger parser settlement before field mapping
    if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
      const fileInput = await page.$('div[data-automation-id="file-upload-drop-zone"] input[type="file"], input[type="file"]').catch(() => null);
      if (fileInput) {
        update('📤 Uploading tailored CV FIRST to trigger ATS parser...');
        await fileInput.setInputFiles(tailoredCV.filePath).catch(() => {});
        update('⏳ Waiting for ATS upload spinner to detach and DOM to settle (max 15s)...');
        await this.bridge.humanDelay(3000, 5000);
      }
    }

    // Initialize Wizard Engine ONCE
    let stepCounter = 0;
    let healAttempts = 0;

    while (true) {
      // 1. Session Liveness Check
      const isLoginRedirect = (await page.$('input[type="password"]:not([style*="display: none"])').catch(() => null)) !== null &&
                              !(await this.areFormFieldsDirectlyOpen(page));
      if (isLoginRedirect) {
        this.recordOutcome(jobInfo, 'FAILED_SESSION_EXPIRED', { code: 'CODE_WIZARD_SESSION_EXPIRED' }, options);
        return { status: 'failed', code: 'CODE_WIZARD_SESSION_EXPIRED' };
      }

      // 2. Step Circuit Breaker (< 12)
      if (stepCounter >= 12) {
        this.recordOutcome(jobInfo, 'FAILED_WIZARD_CYCLIC_LOOP', { code: 'CODE_WIZARD_CYCLIC_OVERFLOW' }, options);
        return { status: 'failed', code: 'CODE_WIZARD_CYCLIC_OVERFLOW' };
      }

      update(`📝 [Wizard Step ${stepCounter + 1}] Scanning visible fields & mapping data...`);
      await this.dismissCookieOverlays(page);

      // 3. Tier 1 Deterministic Fields (Zero AI Guessing)
      await this.applyTier1Deterministic(page, jobInfo);

      // Check for Mandatory Tier 1 Unmapped
      const mandatoryMissing = await this.checkMandatoryTier1Missing(page);
      if (mandatoryMissing) {
        update(`🛑 Mandatory legal/regulatory field missing in profile.json (${mandatoryMissing}). Aborting safely.`);
        this.recordOutcome(jobInfo, 'FAILED_MISSING_LEGAL_CONFIG', { code: 'CODE_MANDATORY_LEGAL_FIELD_UNMAPPED', notes: mandatoryMissing }, options);
        return { status: 'blocked', code: 'CODE_MANDATORY_LEGAL_FIELD_UNMAPPED', missingField: mandatoryMissing };
      }

      // 4. Tier 2 Generative Questions (LLM Grounded in CV facts)
      await this.applyTier2Generative(page, jobInfo);

      // 5. Evaluate Primary Action Button (Pick the VISIBLE button on the active wizard page)
      const allSubmitBtns = await page.$$(
        'button[data-automation-id="bottom-navigation-submit-button"], button:has-text("Submit Application"), input[type="submit"]:has-text("Submit"), button:has-text("Complete Application"), button:has-text("Submit application")'
      ).catch(() => []);
      let submitBtn = null;
      for (const btn of allSubmitBtns) {
        if (await btn.isVisible().catch(() => false)) {
          submitBtn = btn;
          break;
        }
      }

      const allNextBtns = await page.$$(
        'button[data-automation-id="bottom-navigation-next-button"], button:has-text("Next"), button:has-text("Save & Continue"), button:has-text("Continue"), button:has-text("Save and Continue"), input[value="Next"]'
      ).catch(() => []);
      let nextBtn = null;
      for (const btn of allNextBtns) {
        if (await btn.isVisible().catch(() => false)) {
          nextBtn = btn;
          break;
        }
      }

      if (submitBtn && !nextBtn) {
        // Reached Submit page -> Transition to Stage 4
        update('🎯 Final submit button reached. Transitioning to Stage 4 Submit & Verify...');
        break;
      }

      if (nextBtn) {
        update(`Clicking "Next / Continue" (Step ${stepCounter + 1})...`);
        await nextBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(2000, 3500);

        // Step Transition CAPTCHA
        if (await this.isInteractiveCaptchaVisible(page)) {
          this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'step', code: 'CODE_CAPTCHA_STEP_BLOCK' }, options);
          return { status: 'blocked', code: 'CODE_CAPTCHA_STEP_BLOCK', stage: 'step' };
        }

        // Audit Step Validation Errors
        const hasValidationErrors = (await page.$('.error, .is-invalid, [aria-invalid="true"], .field-error, [class*="error-message"], [class*="form-error"], [class*="alert-danger"], .alert-error').catch(() => null)) !== null;
        if (!hasValidationErrors) {
          // Clean Transition: advance step counter and reset heal counter
          stepCounter++;
          healAttempts = 0;
          continue;
        } else {
          // Validation Error Present: check heal circuit
          if (healAttempts >= 1) {
            update('❌ Step validation failed after healing retry. Stopping step loop.');
            this.recordOutcome(jobInfo, 'FAILED_STEP_VALIDATION', { code: 'CODE_STEP_VALIDATION_FAILED' }, options);
            return { status: 'failed', code: 'CODE_STEP_VALIDATION_FAILED' };
          }
          healAttempts++;
          update('⚠️ Form highlighted validation error. Attempting 1 precision heal retry...');
          continue;
        }
      }

      // Neither Next nor Submit button found
      update('❌ No recognizable Next or Submit button found on active step.');
      this.recordOutcome(jobInfo, 'FAILED_WIZARD_NO_BUTTON', { code: 'CODE_WIZARD_NO_ACTION_BUTTON' }, options);
      return { status: 'failed', code: 'CODE_WIZARD_NO_ACTION_BUTTON' };
    }

    // ==========================================
    // STAGE 4: SUBMIT AND VERIFY
    // ==========================================
    update('🚀 [Stage 4] Preparing Final Submission & Verification...');
    const execMode = options.mode || options.settings?.execution?.mode || 'autonomous';
    const isReviewMode = execMode === 'review' || options.settings?.execution?.pauseForReviewInHybridMode === true;

    if (isReviewMode) {
      update('🔔 [Review Mode] Application complete. Pausing for 300s candidate review...');
      // In hybrid/review mode, wait for user input or auto-proceed after window
      await this.bridge.humanDelay(5000, 8000);
    }

    // Dry-Run Interceptor: Stop before final submit click
    const isDryRun = options.dryRun === true || options.settings?.execution?.dryRun === true || process.argv.includes('--dry-run');
    if (isDryRun) {
      update('🧪 [DRY-RUN] Pre-submit dry-run gate reached. Stopping execution before final submit click.');
      update(`✓ Form is fully filled with tailored CV (${tailoredCV?.fileName || 'standard'}) and ready for inspection.`);
      return { status: 'dry_run_complete', code: 'DRY_RUN_STOPPED_BEFORE_SUBMIT', page, tailoredCV: tailoredCV?.fileName };
    }

    // Pre-Submit CAPTCHA Audit
    if (await this.isInteractiveCaptchaVisible(page)) {
      this.recordOutcome(jobInfo, 'BLOCKED_CAPTCHA', { stage: 'submit', code: 'CODE_CAPTCHA_SUBMIT_BLOCK' }, options);
      return { status: 'blocked', code: 'CODE_CAPTCHA_SUBMIT_BLOCK', stage: 'submit' };
    }

    const finalSubmitBtns = await page.$$(
      'button[data-automation-id="bottom-navigation-submit-button"], button:has-text("Submit Application"), input[type="submit"], button:has-text("Complete Application"), button:has-text("Submit"), button:has-text("Send Application")'
    ).catch(() => []);
    let finalSubmitBtn = null;
    for (const btn of finalSubmitBtns) {
      if (await btn.isVisible().catch(() => false)) {
        finalSubmitBtn = btn;
        break;
      }
    }

    if (finalSubmitBtn && await finalSubmitBtn.isVisible().catch(() => false)) {
      update('Dispatched Final "Submit Application" click...');
      await finalSubmitBtn.click({ force: true }).catch(() => {});
      update('Waiting for network idle (15s) and DOM confirmation receipt...');
      await this.bridge.humanDelay(4000, 7000);

      // Audit Post-Submit Inline Errors
      const postSubmitErrors = (await page.$('.error, .is-invalid, span.field-error, div.alert-danger').catch(() => null)) !== null;
      if (postSubmitErrors) {
        update('❌ Form displayed inline validation error after submit click.');
        this.recordOutcome(jobInfo, 'FAILED_STEP_VALIDATION', { code: 'CODE_FINAL_SUBMIT_VALIDATION_ERROR' }, options);
        return { status: 'failed', code: 'CODE_FINAL_SUBMIT_VALIDATION_ERROR' };
      }

      // Check Submission Proof
      const postUrl = page.url().toLowerCase();
      const pageText = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(() => '');
      const hasProof = postUrl.includes('/thank') || postUrl.includes('/confirm') || postUrl.includes('/submitted') ||
                       pageText.includes('application submitted') || pageText.includes('thank you for applying') ||
                       pageText.includes('we have received your application');

      if (hasProof) {
        update('🎉 APPLIED_CONFIRMED! Valid proof receipt detected in DOM.');
        this.recordOutcome(jobInfo, 'APPLIED_CONFIRMED', {
          code: 'CODE_APPLICATION_CONFIRMED',
          cvUsed: tailoredCV?.fileName,
          notes: 'Verified via DOM confirmation receipt'
        }, options);
        return { status: 'applied', code: 'APPLIED_CONFIRMED', tailoredCV: tailoredCV?.fileName };
      } else {
        update('⚠️ Unconfirmed / Network drop. Recording UNVERIFIED_MANUAL_CHECK to prevent duplicate re-runs.');
        this.recordOutcome(jobInfo, 'UNVERIFIED_MANUAL_CHECK', {
          code: 'CODE_SUBMISSION_UNVERIFIED_STATE',
          cvUsed: tailoredCV?.fileName,
          notes: 'Dispatched submit, receipt pending manual verification'
        }, options);
        return { status: 'unverified', code: 'UNVERIFIED_MANUAL_CHECK', tailoredCV: tailoredCV?.fileName };
      }
    }

    this.recordOutcome(jobInfo, 'FAILED_WIZARD_NO_BUTTON', { code: 'CODE_SUBMIT_BUTTON_NOT_FOUND' }, options);
    return { status: 'failed', code: 'CODE_SUBMIT_BUTTON_NOT_FOUND' };
  }

  /**
   * Tier 1 Deterministic Fields: Legal, Auth, EEO, Salary, Experience
   */
  async applyTier1Deterministic(page, jobInfo) {
    const profile = this.getProfile();
    const p = profile.personal || {};
    const w = profile.workAuthorization || {};
    const c = profile.compensationAndAvailability || {};

    // Standard Contact Fields
    await this.safeType(page, 'input[name*="first_name" i], input[id*="first_name" i]', p.firstName || 'Shoaib');
    await this.safeType(page, 'input[name*="last_name" i], input[id*="last_name" i]', p.lastName || 'Akhtar');
    await this.safeType(page, 'input[type="email"], input[name*="email" i]', p.email || 'onlyshoaib158@gmail.com');
    await this.safeType(page, 'input[type="tel"], input[name*="phone" i]', p.phone || '+923056054842');
    await this.safeType(page, 'input[name*="linkedin" i]', p.links?.linkedin || 'https://www.linkedin.com/in/shoaib-akhtar-133103300/');
    await this.safeType(page, 'input[name*="github" i]', p.links?.github || 'https://github.com/Shoaib-Akhtarr');
    await this.safeType(page, 'input[name*="city" i]', p.address?.city || 'Gujrat');

    // Salary Expectations
    if (c.desiredSalaryNumeric) {
      await this.safeType(page, 'input[name*="salary" i], input[placeholder*="salary" i]', String(c.desiredSalaryNumeric));
    }

    // Work Authorization Selects / Radios
    // Workday Specific Name and Contact Fields
    await this.safeType(page, 'input[data-automation-id="legalNameSection_firstName"]', p.firstName || 'Shoaib');
    await this.safeType(page, 'input[data-automation-id="legalNameSection_lastName"]', p.lastName || 'Akhtar');
    await this.safeType(page, 'input[data-automation-id="phone-number"]', p.phone || '+923056054842');
    await this.safeType(page, 'input[data-automation-id="addressSection_addressLine1"]', p.address?.street || 'Model Town');
    await this.safeType(page, 'input[data-automation-id="addressSection_city"]', p.address?.city || 'Gujrat');
    await this.safeType(page, 'input[data-automation-id="addressSection_postalCode"]', p.address?.postalCode || '50700');

    const selects = await page.$$('select');
    for (const sel of selects) {
      const label = await page.evaluate(el => {
        const l = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        return l ? l.innerText.toLowerCase() : '';
      }, sel);

      if (label.includes('authorized to work') || label.includes('legally authorized')) {
        await sel.selectOption({ label: 'Yes' }).catch(() => {});
      } else if (label.includes('sponsorship') || label.includes('require visa')) {
        await sel.selectOption({ label: w.requireSponsorship || 'Yes' }).catch(() => {});
      }
    }

    // Legal Certifications / Terms Checkboxes (Respect explicit opt-in flag)
    const legal = profile.legalAttestations || {};
    const certChecks = await page.$$('input[type="checkbox"]');
    for (const chk of certChecks) {
      const label = await page.evaluate(el => el.closest('label')?.innerText.toLowerCase() || '', chk);
      
      const isCertification = label.includes('certify') || label.includes('truth') || label.includes('penalty of perjury');
      const isTerms = label.includes('terms') || label.includes('privacy') || label.includes('acknowledge');

      if (isCertification) {
        if (legal.consentToCertify === true) {
          if (!(await chk.isChecked().catch(() => true))) await chk.check().catch(() => {});
        }
      } else if (isTerms) {
        if (legal.consentToTerms !== false) {
          if (!(await chk.isChecked().catch(() => true))) await chk.check().catch(() => {});
        }
      }
    }
  }

  async checkMandatoryTier1Missing(page) {
    const profile = this.getProfile();
    const legal = profile.legalAttestations || {};

    // Check if mandatory certification checkbox is present without candidate opt-in
    if (legal.consentToCertify !== true) {
      const certChecks = await page.$$('input[type="checkbox"]');
      for (const chk of certChecks) {
        const label = await page.evaluate(el => el.closest('label')?.innerText.toLowerCase() || '', chk);
        if (label.includes('certify') || label.includes('truth') || label.includes('penalty of perjury')) {
          return 'consentToCertify_opt_in_missing';
        }
      }
    }

    const requiredInputs = await page.$$('input[required], select[required]');
    for (const inp of requiredInputs) {
      const val = await inp.inputValue().catch(() => '');
      if (!val) {
        const name = await inp.getAttribute('name') || await inp.getAttribute('id') || 'unnamed_field';
        if (name.toLowerCase().includes('legal') || name.toLowerCase().includes('sponsor') || name.toLowerCase().includes('clearance')) {
          return name;
        }
      }
    }
    return null;
  }

  /**
   * Tier 2 Generative Questions: Freeform Technical Essays & Role Fit
   */
  async applyTier2Generative(page, jobInfo) {
    try {
      const textareas = await page.$$('textarea');
      for (const ta of textareas) {
        if (!(await ta.isVisible().catch(() => false))) continue;
        const currentVal = await ta.inputValue().catch(() => '');
        if (currentVal.length > 10) continue; // Already populated

        const label = await page.evaluate(el => {
          const l = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
          return l ? l.innerText : '';
        }, ta);

        if (label) {
          const answer = questionEngine.answerQuestion(label, [], 'textarea', jobInfo);
          if (answer && answer.answer) {
            await ta.fill(answer.answer).catch(() => {});
            await this.bridge.humanDelay(200, 400);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Fallback Helpers & Profile Accessors
   */
  getCandidateEmail() {
    const profile = this.getProfile();
    return profile.personal?.email || 'onlyshoaib158@gmail.com';
  }

  getMasterPassword() {
    const profile = this.getProfile();
    return profile.personal?.masterPassword || process.env.AUTONOMOUS_PORTAL_PASSWORD || 'ShoaibAkhtar2026!#';
  }

  getProfile() {
    try {
      const p = path.join(__dirname, '..', 'config', 'profile.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (_) {}
    return {};
  }

  async findApplyButton(page) {
    const selectors = [
      'button:has-text("Apply on company website")',
      'a:has-text("Apply on company website")',
      'button:has-text("Apply on company site")',
      'a:has-text("Apply on company site")',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '.jobs-apply-button'
    ];
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        return el;
      }
    }
    return null;
  }

  async handleLinkedInRedirectModal(page, update) {
    try {
      const modalContinueBtn = await page.$(
        'button:has-text("Continue applying"), button:has-text("Continue"), a:has-text("Continue")'
      ).catch(() => null);
      if (modalContinueBtn && await modalContinueBtn.isVisible().catch(() => false)) {
        update('Bypassing LinkedIn external redirect confirmation dialog...');
        await modalContinueBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(1000, 2000);
      }
    } catch (_) {}
  }

  async safeType(page, selector, text) {
    if (!text) return;
    try {
      const el = await page.$(selector).catch(() => null);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await el.fill(text).catch(() => {});
        await this.bridge.humanDelay(100, 250);
      }
    } catch (_) {}
  }

  async applyDirectUrl(page, jobInfo, options = {}) {
    jobInfo.url = this.normalizeAtsUrl(jobInfo.url);
    await page.goto(jobInfo.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    return await this.handleExternalApply(page, jobInfo, options);
  }
}

module.exports = ExternalApplyEngine;
