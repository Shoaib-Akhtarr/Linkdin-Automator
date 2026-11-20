const { chromium } = require('playwright');
const fs = require('fs');

async function testStep() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  // Find dialog
  const dialog = await page.$('dialog[open], [data-testid="dialog"], [data-testid="dialog-content"], [data-sdui-screen*="EasyApply"]');
  console.log('Dialog found?', !!dialog);

  // Find Next button
  const nextBtn = await page.$('dialog button:has-text("Next"), [data-testid="dialog"] button:has-text("Next"), button:has-text("Next")');
  console.log('Next button found?', !!nextBtn);

  if (nextBtn) {
    console.log('Clicking Next button...');
    await nextBtn.click({ force: true });
    await page.waitForTimeout(3000);

    const cdp = await context.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    fs.writeFileSync('scripts/after_next_click.jpg', Buffer.from(data, 'base64'));
    console.log('Saved screenshot to scripts/after_next_click.jpg');

    // Inspect inputs on the new step
    const inputs = await page.evaluate(() => {
      const active = document.querySelector('dialog[open], [data-testid="dialog"]');
      if (!active) return 'No active dialog';

      return Array.from(active.querySelectorAll('input, select, textarea, fieldset, label, button')).map(el => {
        return {
          tag: el.tagName.toLowerCase(),
          type: el.type,
          id: el.id,
          name: el.name,
          text: (el.innerText || '').slice(0, 100).trim(),
          ariaLabel: el.getAttribute('aria-label') || ''
        };
      });
    });

    console.log('New step elements:');
    console.log(JSON.stringify(inputs, null, 2));
  }
}

testStep().catch(console.error);
