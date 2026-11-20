const fs = require('fs');
const path = require('path');

const ottaPath = path.join(__dirname, '..', 'engine', 'platforms', 'ottaEngine.js');
let code = fs.readFileSync(ottaPath, 'utf8');

if (!code.includes("require('../vaultManager')")) {
  code = "const vaultManager = require('../vaultManager');\r\n" + code;
}

const loginMethod = `
  /**
   * Autonomous login using stored credentials from vault
   */
  async loginWithCredentials(page, creds) {
    if (!creds || !creds.email || !creds.password) return false;
    try {
      await page.goto('https://app.otta.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.bridge.humanDelay(1500, 2500);

      const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email"]');
      if (emailInput) {
        await emailInput.fill(creds.email);
        await this.bridge.humanDelay(500, 1000);
      }

      const passInput = await page.$('input[type="password"], input[name="password"], input[id*="password"]');
      if (passInput) {
        await passInput.fill(creds.password);
        await this.bridge.humanDelay(500, 1000);
      }

      const submitBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
        await this.bridge.humanDelay(2000, 3000);
      }

      return await this.isLoggedIn(page);
    } catch (e) {
      console.warn('[OttaEngine] Auto-login error:', e.message);
      return false;
    }
  }
`;

if (!code.includes('loginWithCredentials')) {
  code = code.replace(/async searchJobs/, loginMethod + '\r\n  async searchJobs');
  fs.writeFileSync(ottaPath, code, 'utf8');
  console.log('✅ Added loginWithCredentials to ottaEngine.js');
} else {
  console.log('loginWithCredentials already present in ottaEngine.js');
}
