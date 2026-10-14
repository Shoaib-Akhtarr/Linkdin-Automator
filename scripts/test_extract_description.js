const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('linkedin.com'));
    
    const selectors = [
      '#job-details',
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      'article',
      '[data-testid="job-details"]'
    ];

    for (const s of selectors) {
      const el = await page.$(s);
      if (el) {
        const text = (await el.innerText()).trim();
        console.log(`Selector "${s}" MATCHED! Length: ${text.length} chars.`);
        console.log(`Preview:\n${text.slice(0, 300)}\n---`);
      }
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
