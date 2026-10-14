const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    const dialog = await page.$('dialog[open], [data-testid="dialog"]');
    const buttons = await dialog.$$('button');
    console.log('Buttons on Review page:');
    for (const btn of buttons) {
      const txt = (await btn.innerText()).trim();
      const aria = await btn.getAttribute('aria-label');
      const disabled = await btn.isDisabled();
      console.log(`- text="${txt}", aria="${aria}", disabled=${disabled}`);
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
