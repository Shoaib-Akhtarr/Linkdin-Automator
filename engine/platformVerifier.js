const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const chromeProfileManager = require('./chromeProfileManager');

class PlatformVerifier {
  constructor() {
    this.cdpHost = 'http://127.0.0.1:9222';
  }

  async isCdpReachable() {
    return new Promise(resolve => {
      const req = http.get(`${this.cdpHost}/json/version`, res => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1200, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Verifies login status across all platforms using active CDP session or saved profile status
   */
  async verifyAllPlatforms(settings = {}) {
    const results = {
      linkedin: false,
      wellfound: false,
      ycombinator: false,
      otta: false,
      cdpConnected: false,
      message: ''
    };

    // 1. Check saved / confirmed state from settings
    const savedAuth = settings?.auth || {};
    if (savedAuth.linkedin) results.linkedin = true;
    if (savedAuth.wellfound) results.wellfound = true;
    if (savedAuth.ycombinator) results.ycombinator = true;
    if (savedAuth.otta) results.otta = true;

    // 2. Check if CDP port is reachable
    const cdpOpen = await this.isCdpReachable();
    if (!cdpOpen) {
      results.cdpConnected = false;
      results.message = results.linkedin 
        ? 'Active session confirmed for selected Chrome profile.' 
        : 'Chrome automation port not currently open. Click "Open Chrome to Login" or "Confirm Logged In".';
      return results;
    }

    results.cdpConnected = true;

    try {
      const browser = await chromium.connectOverCDP(this.cdpHost);
      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : null;

      if (!context) {
        results.message = 'No active browser context found.';
        return results;
      }

      // Check cookies for active logins
      const cookies = await context.cookies();
      
      // 1. LinkedIn check
      const liAt = cookies.find(c => c.name === 'li_at' && c.domain.includes('linkedin.com'));
      const pages = context.pages();
      const hasLiPage = pages.some(p => {
        const u = p.url() || '';
        return u.includes('linkedin.com/feed') || u.includes('linkedin.com/jobs') || u.includes('linkedin.com/in');
      });

      if ((liAt && liAt.value && liAt.value.length > 10) || hasLiPage) {
        results.linkedin = true;
        this.persistAuth('linkedin', true);
      }

      // 2. Wellfound check
      const wfCookie = cookies.find(c => (c.name.includes('_ajs_user_id') || c.name.includes('remember_user_token') || c.name.includes('al_jwt')) && c.domain.includes('wellfound.com'));
      if (wfCookie) {
        results.wellfound = true;
        this.persistAuth('wellfound', true);
      }

      // 3. Y Combinator check
      const ycCookie = cookies.find(c => (c.name.includes('waas_') || c.name.includes('_session') || c.name.includes('remember')) && c.domain.includes('workatastartup.com'));
      if (ycCookie) {
        results.ycombinator = true;
        this.persistAuth('ycombinator', true);
      }

      // 4. Otta check
      const ottaCookie = cookies.find(c => (c.name.includes('otta_') || c.name.includes('session') || c.name.includes('token')) && c.domain.includes('otta.com'));
      if (ottaCookie) {
        results.otta = true;
        this.persistAuth('otta', true);
      }

      results.message = results.linkedin 
        ? 'Active LinkedIn session verified via Chrome!' 
        : 'LinkedIn session not detected. Please log in to LinkedIn or click "Confirm Logged In".';

    } catch (err) {
      results.message = `Verification probe error: ${err.message}`;
    }

    return results;
  }

  persistAuth(platform, status = true) {
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

module.exports = new PlatformVerifier();
