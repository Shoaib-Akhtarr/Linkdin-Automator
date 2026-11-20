const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    
    // Find job cards
    const cards = await page.$$('[data-testid="lazy-column"] div[role="button"], div.job-card-container, div[data-job-id]');
    console.log('Cards found:', cards.length);
    if (cards.length > 0) {
      await cards[0].scrollIntoViewIfNeeded();
      await cards[0].click();
      await page.waitForTimeout(2500);
      
      // Look for Easy Apply button
      const eaBtn = await page.$('button.jobs-apply-button, button[aria-label*="Easy Apply"], button:has-text("Easy Apply")');
      console.log('Easy Apply button found:', !!eaBtn);
      if (eaBtn) {
        console.log('Easy Apply text:', (await eaBtn.innerText()).trim());
        await eaBtn.click();
        await page.waitForTimeout(2500);
        
        const dialog = await page.$('dialog[open], [data-testid="dialog"], [data-sdui-screen*="EasyApply"]');
        console.log('Dialog found:', !!dialog);
        if (dialog) {
          const selects = await dialog.$$('select');
          console.log('Selects in dialog:', selects.length);
          for (const sel of selects) {
            const id = await sel.getAttribute('id');
            const options = await sel.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
            console.log('Select ID:', id, 'Options:', JSON.stringify(options));
          }
          
          const buttons = await dialog.$$('button');
          console.log('Buttons in dialog:', buttons.length);
          for (const btn of buttons) {
            const txt = (await btn.innerText()).trim();
            const aria = await btn.getAttribute('aria-label');
            const disabled = await btn.isDisabled();
            console.log(`Button: text="${txt}", aria="${aria}", disabled=${disabled}`);
          }
        }
      }
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
