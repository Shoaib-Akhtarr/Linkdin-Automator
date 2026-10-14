const { chromium } = require('playwright');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_USER_DATA_DIR = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\mshoa\\AppData\\Local',
  'LinkedInAutomationChromeProfile'
);

class BrowserBridge {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdpSession = null;
    this.cdpHost = 'http://127.0.0.1:9222';
    this.chromeProcess = null;
  }

  async isCdpReachable(host = this.cdpHost) {
    return new Promise(resolve => {
      const url = `${host}/json/version`;
      const req = http.get(url, res => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async launchChromeIfNeeded(userDataDir = DEFAULT_USER_DATA_DIR) {
    const reachable = await this.isCdpReachable();
    if (reachable) {
      console.log('✓ Chrome CDP already active on port 9222.');
      return;
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    console.log('Starting Google Chrome with remote debugging port 9222...');
    this.chromeProcess = spawn(
      CHROME_PATH,
      [
        '--remote-debugging-port=9222',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'https://www.linkedin.com/jobs/'
      ],
      {
        detached: true,
        stdio: 'ignore'
      }
    );
    this.chromeProcess.unref();

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.isCdpReachable()) {
        console.log('✓ Chrome successfully launched and CDP port 9222 is open.');
        return;
      }
    }

    throw new Error('Timed out waiting for Chrome to start with remote debugging port 9222.');
  }

  async connect() {
    await this.launchChromeIfNeeded();

    console.log('Connecting Playwright over CDP to Chrome...');
    this.browser = await chromium.connectOverCDP(this.cdpHost);

    const contexts = this.browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();

    const pages = this.context.pages();
    const existingLinkedInPage = pages.find(p => p.url().includes('linkedin.com'));
    if (existingLinkedInPage) {
      this.page = existingLinkedInPage;
    } else if (pages.length > 0) {
      this.page = pages[0];
    } else {
      this.page = await this.context.newPage();
    }

    try {
      this.cdpSession = await this.context.newCDPSession(this.page);
    } catch (e) {
      this.cdpSession = null;
    }

    return this.page;
  }

  async getPage() {
    if (!this.page || this.page.isClosed()) {
      await this.connect();
    }
    return this.page;
  }

  async humanDelay(min = 1500, max = 3500) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, delay));
  }

  async takeScreenshot() {
    if (!this.page || this.page.isClosed()) return null;
    try {
      if (!this.cdpSession) {
        this.cdpSession = await this.context.newCDPSession(this.page);
      }
      // Instant native CDP GPU screenshot (doesn't hang on font loading!)
      const { data } = await this.cdpSession.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 70
      });
      return data;
    } catch (e) {
      // Fallback
      try {
        const buf = await this.page.screenshot({ timeout: 2000, animations: 'disabled' });
        return buf.toString('base64');
      } catch (err) {
        return null;
      }
    }
  }

  async isLinkedInLoggedIn() {
    if (!this.page) return false;
    const url = this.page.url();
    if (url.includes('linkedin.com/login') || url.includes('linkedin.com/checkpoint')) {
      return false;
    }
    const navExists = await this.page.$('.global-nav, .jobs-search-box, .feed-identity-module, header, nav, #global-nav');
    return !!navExists || url.includes('linkedin.com/feed') || url.includes('linkedin.com/jobs');
  }

  async disconnect() {
    if (this.cdpSession) {
      try { await this.cdpSession.detach(); } catch (e) {}
      this.cdpSession = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = new BrowserBridge();
