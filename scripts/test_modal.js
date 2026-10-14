const { chromium } = require('playwright');

async function testOpenModal() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const btn = await page.$('button[aria-label*="Easy Apply"], button:has-text("Easy Apply")');
  if (btn) {
    console.log('Clicking Easy Apply button...');
    await btn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'scripts/debug_modal.png' });
    console.log('Saved modal screenshot to scripts/debug_modal.png');

    // Inspect elements inside the modal
    const modalInfo = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"], .jobs-easy-apply-modal, [data-test-modal]');
      if (!modal) return { found: false };

      const inputs = Array.from(modal.querySelectorAll('input, select, textarea, button')).map(el => {
        return {
          tag: el.tagName.toLowerCase(),
          type: el.type,
          id: el.id,
          ariaLabel: el.getAttribute('aria-label') || '',
          value: el.value,
          text: (el.innerText || '').trim()
        };
      });

      return { found: true, inputs };
    });

    console.log('Modal elements:', JSON.stringify(modalInfo, null, 2));
  } else {
    console.log('No Easy Apply button found.');
  }
}

testOpenModal().catch(console.error);
