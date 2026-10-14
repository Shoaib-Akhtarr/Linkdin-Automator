const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    const dialog = await page.$('dialog[open], [data-testid="dialog"]');
    if (dialog) {
      const dismissBtn = await dialog.$('button[aria-label="Dismiss"]');
      if (dismissBtn) {
        await dismissBtn.click();
        await page.waitForTimeout(1000);
        // Look for discard button
        const discardBtn = await page.$('button[data-control-name="discard_application_confirm_btn"], button:has-text("Discard")');
        if (discardBtn) {
          await discardBtn.click();
          console.log('Discarded application dialog.');
        }
      }
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
