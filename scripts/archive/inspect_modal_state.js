const { chromium } = require('playwright');
const fs = require('fs');

async function inspectModalState() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  console.log('Current URL:', page.url());

  // Check what modals or dialogs are open on the page right now
  const modalData = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-test-modal], .jobs-easy-apply-modal, div[aria-modal="true"]'));
    return dialogs.map(d => ({
      tagName: d.tagName,
      role: d.getAttribute('role'),
      className: d.className,
      ariaLabel: d.getAttribute('aria-label') || '',
      htmlSnippet: d.innerHTML.slice(0, 500)
    }));
  });

  console.log('Open Dialogs count:', modalData.length);
  console.log(JSON.stringify(modalData, null, 2));

  // Capture screen
  const cdp = await context.newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  fs.writeFileSync('scripts/live_current_state.jpg', Buffer.from(data, 'base64'));
  console.log('Saved screenshot to scripts/live_current_state.jpg');
}

inspectModalState().catch(console.error);
