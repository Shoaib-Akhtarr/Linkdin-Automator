const { chromium } = require('playwright');
const fs = require('fs');

async function scrollDialogAndCheck() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  // Scroll dialog container
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open], [data-testid="dialog"], [data-testid="dialog-content"]');
    if (dialog) {
      dialog.scrollTop = dialog.scrollHeight;
    }
  });
  await page.waitForTimeout(1000);

  const cdp = await context.newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  fs.writeFileSync('scripts/dialog_scrolled_bottom.jpg', Buffer.from(data, 'base64'));
  console.log('Saved screenshot to scripts/dialog_scrolled_bottom.jpg');

  const btns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => {
      const rect = b.getBoundingClientRect();
      return {
        text: (b.innerText || '').trim(),
        ariaLabel: b.getAttribute('aria-label') || '',
        visible: rect.width > 0 && rect.height > 0
      };
    }).filter(b => b.visible && (b.text || b.ariaLabel));
  });

  console.log('Visible buttons at bottom:');
  console.log(JSON.stringify(btns, null, 2));
}

scrollDialogAndCheck().catch(console.error);
