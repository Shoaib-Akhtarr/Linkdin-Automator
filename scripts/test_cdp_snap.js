const { chromium } = require('playwright');
const fs = require('fs');

async function testCdpScreenshot() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const cdp = await page.context().newCDPSession(page);
  const start = Date.now();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 75 });
  console.log(`Captured in ${Date.now() - start}ms! Buffer size: ${data.length}`);
  fs.writeFileSync('scripts/cdp_snap.jpg', Buffer.from(data, 'base64'));
}

testCdpScreenshot().catch(console.error);
