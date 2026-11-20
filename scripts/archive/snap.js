const { chromium } = require('playwright');

async function snap() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  try {
    const buffer = await page.screenshot({ timeout: 5000 });
    const fs = require('fs');
    fs.writeFileSync('scripts/debug_snap.png', buffer);
    console.log('Saved snap!');
  } catch (e) {
    console.error('Snap error:', e.message);
  }
}

snap().catch(console.error);
