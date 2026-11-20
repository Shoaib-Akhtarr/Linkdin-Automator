const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    const dialog = await page.$('dialog[open], [data-testid="dialog"]');
    if (!dialog) {
      console.log('No dialog!');
      return;
    }

    const inputs = await dialog.$$('input[type="text"], input[type="number"]');
    console.log(`Found ${inputs.length} text inputs in dialog.`);
    for (const input of inputs) {
      const val = await input.inputValue();
      console.log('Input current value:', val);
      if (val === 'Yes' || val === 'yes') {
        console.log('Changing "Yes" to "2"...');
        await input.fill('2');
        await page.waitForTimeout(300);
      }
    }

    // Now check Next button
    const nextBtn = await dialog.$('button:has-text("Next")');
    if (nextBtn) {
      console.log('Clicking Next button...');
      await nextBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'scripts/after_fix_click.jpg' });
      console.log('Saved screenshot to scripts/after_fix_click.jpg');
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
