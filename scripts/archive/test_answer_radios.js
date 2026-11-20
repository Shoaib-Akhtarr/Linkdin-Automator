const { chromium } = require('playwright');
const questionEngine = require('../engine/questionEngine');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    
    let dialog = await page.$('dialog[open], [data-testid="dialog"], [data-sdui-screen*="EasyApply"]');
    if (!dialog) {
      console.log('No dialog open!');
      return;
    }

    // Find all radio groups (fieldset or div[role="radiogroup"])
    const groups = await dialog.$$('fieldset[role="radiogroup"], fieldset, div[role="radiogroup"]');
    console.log(`Found ${groups.length} radio groups.`);

    for (let i = 0; i < groups.length; i++) {
      const grp = groups[i];
      
      // Question text: check parent container text before fieldset, or aria-label of child radio
      let question = '';
      const parent = await grp.evaluateHandle(el => el.closest('[componentkey]') || el.parentElement);
      if (parent) {
        question = await parent.evaluate(el => {
          const p = el.querySelector('p, h3, label, legend');
          return p ? p.innerText.trim() : '';
        });
      }
      if (!question) {
        // Fallback to child role="radio" aria-label
        const radioDiv = await grp.$('div[role="radio"]');
        if (radioDiv) {
          question = (await radioDiv.getAttribute('aria-label') || '').trim();
        }
      }

      console.log(`\nGroup [${i}] Question: "${question}"`);

      // Find options inside this group
      const radios = await grp.$$('div[role="radio"], input[type="radio"]');
      const radioDivs = await grp.$$('div[role="radio"]');
      
      const options = [];
      for (const rDiv of radioDivs) {
        const text = (await rDiv.innerText()).trim();
        options.push({ element: rDiv, text });
      }

      console.log(`Options found:`, options.map(o => o.text));

      // Evaluate question
      const evalResult = questionEngine.evaluateQuestion(question, 'radio', options.map(o => o.text));
      console.log(`Evaluated answer: "${evalResult.answer}" (Confidence: ${evalResult.confidence})`);

      // Find best matching option
      const target = options.find(o => o.text.toLowerCase() === String(evalResult.answer).toLowerCase())
        || options.find(o => o.text.toLowerCase().includes(String(evalResult.answer).toLowerCase()))
        || options[0];

      if (target) {
        console.log(`Clicking option: "${target.text}"`);
        await target.element.click();
        await page.waitForTimeout(500);
      }
    }

    // Now look at Review button
    const reviewBtn = await dialog.$('button:has-text("Review"), button[aria-label*="Review"]');
    if (reviewBtn) {
      console.log('Clicking Review button...');
      await reviewBtn.click();
      await page.waitForTimeout(2000);
      
      // Check if we advanced to next step
      const afterDialog = await page.$('dialog[open], [data-testid="dialog"]');
      if (afterDialog) {
        const afterText = await afterDialog.innerText();
        console.log('Dialog content after Review click (first 300 chars):', afterText.slice(0, 300));
        await page.screenshot({ path: 'scripts/after_review_click.jpg' });
        console.log('Saved screenshot to scripts/after_review_click.jpg');
      }
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
