const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    
    let dialog = await page.$('dialog[open], [data-testid="dialog"], [data-sdui-screen*="EasyApply"]');
    if (!dialog) {
      console.log('No dialog open!');
      return;
    }

    // Save screenshot
    await page.screenshot({ path: 'scripts/step3_screenshot.jpg' });
    console.log('Screenshot saved to scripts/step3_screenshot.jpg');

    // Get dialog HTML
    const html = await dialog.innerHTML();
    fs.writeFileSync('scripts/step3_dialog.html', html, 'utf8');
    console.log('Saved dialog HTML to scripts/step3_dialog.html');

    // Inspect all form elements in dialog
    const elements = await dialog.$$('fieldset, .fb-form-element, [data-test-form-builder-radio-button-form-component="true"], [data-test-form-element]');
    console.log(`Found ${elements.length} fieldsets/form-elements:`);
    for (const el of elements) {
      const text = (await el.innerText()).trim().replace(/\n+/g, ' | ');
      console.log('--- FORM ELEMENT ---: ', text);
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
