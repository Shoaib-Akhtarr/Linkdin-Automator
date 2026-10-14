const { chromium } = require('playwright');

async function testLazyColumn() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const jobs = await page.evaluate(() => {
    // Check both new LazyColumn layout and legacy list containers
    const lazyColumn = document.querySelector('[data-testid="lazy-column"], [data-component-type="LazyColumn"]');
    
    // Find all card buttons
    let cards = [];
    if (lazyColumn) {
      cards = Array.from(lazyColumn.querySelectorAll('div[role="button"]'));
    }
    if (cards.length === 0) {
      cards = Array.from(document.querySelectorAll('li[data-occludable-job-id], div.job-card-container, div[data-job-id]'));
    }

    return cards.map((card, idx) => {
      const text = (card.innerText || '').trim();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        index: idx,
        lines: lines.slice(0, 5),
        hasEasyApply: text.toLowerCase().includes('easy apply')
      };
    });
  });

  console.log(`Found ${jobs.length} cards in LazyColumn:`);
  console.log(JSON.stringify(jobs, null, 2));
}

testLazyColumn().catch(console.error);
