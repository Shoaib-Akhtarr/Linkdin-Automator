const { chromium } = require('playwright');
const questionEngine = require('../engine/questionEngine');
const cvMatcher = require('../engine/cvMatcher');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    
    let dialog = await page.$('dialog[open], [data-testid="dialog"], [data-sdui-screen*="EasyApply"]');
    if (!dialog) {
      console.log('No dialog open!');
      return;
    }

    for (let step = 1; step <= 8; step++) {
      console.log(`\n=== STEP ${step} ===`);
      
      // Print all inputs
      const inputs = await dialog.$$('input, select, textarea');
      console.log(`Found ${inputs.length} input elements in dialog:`);
      for (const input of inputs) {
        const tagName = await input.evaluate(el => el.tagName.toLowerCase());
        const type = await input.getAttribute('type');
        const id = await input.getAttribute('id');
        const name = await input.getAttribute('name');
        const ariaLabel = await input.getAttribute('aria-label');
        let label = '';
        if (id) {
          const l = await page.$(`label[for="${id}"]`);
          if (l) label = (await l.innerText()).trim();
        }
        if (!label) {
          label = await input.evaluate(el => {
            const p = el.closest('label') || el.closest('.fb-form-element') || el.closest('div');
            return p ? p.innerText.slice(0, 100) : '';
          });
        }
        
        let value = '';
        if (tagName === 'select') {
          const opts = await input.$$eval('option', os => os.map(o => ({ value: o.value, text: o.text.trim() })));
          value = `[SELECT with ${opts.length} options: ${opts.slice(0, 5).map(o => o.text).join(', ')}...]`;
        } else {
          value = await input.inputValue().catch(() => '');
        }
        console.log(`- <${tagName} type="${type}" id="${id}"> Label: "${label.replace(/\n+/g, ' ')}" | Current: "${value}"`);
      }
      
      // Print buttons
      const buttons = await dialog.$$('button');
      console.log(`Buttons (${buttons.length}):`);
      for (const btn of buttons) {
        const txt = (await btn.innerText()).trim();
        const aria = await btn.getAttribute('aria-label');
        const disabled = await btn.isDisabled();
        console.log(`  [button] text="${txt}" aria="${aria}" disabled=${disabled}`);
      }
      
      // Find Next or Review or Submit
      let actionBtn = null;
      for (const btn of buttons) {
        const txt = (await btn.innerText()).trim().toLowerCase();
        const aria = (await btn.getAttribute('aria-label') || '').toLowerCase();
        const disabled = await btn.isDisabled();
        if (disabled) continue;
        if (txt.includes('back') || aria.includes('back') || aria.includes('dismiss')) continue;
        if (txt === 'submit application' || txt === 'submit') {
          actionBtn = { name: 'Submit', btn };
          break;
        }
        if (txt === 'review') {
          actionBtn = { name: 'Review', btn };
          break;
        }
        if (txt === 'next') {
          actionBtn = { name: 'Next', btn };
          break;
        }
      }
      
      if (!actionBtn) {
        console.log('No active action button found. Breaking.');
        break;
      }
      
      console.log(`Clicking ${actionBtn.name} button...`);
      await actionBtn.btn.click();
      await page.waitForTimeout(2000);
      dialog = await page.$('dialog[open], [data-testid="dialog"], [data-sdui-screen*="EasyApply"]');
      if (!dialog) {
        console.log('Dialog closed after click!');
        break;
      }
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
