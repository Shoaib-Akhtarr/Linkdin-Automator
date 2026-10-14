const { chromium } = require('playwright');

async function inspectDOM() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const info = await page.evaluate(() => {
    const all = Array.from(document.body.querySelectorAll('*'));
    const matches = all.filter(el => {
      const text = (el.innerText || '').trim();
      return (text === 'AI Product Developer' || text === 'TechieMinions' || text === 'AI Integration Engineer');
    });

    return matches.slice(0, 3).map(el => {
      let curr = el;
      const hierarchy = [];
      while (curr && curr !== document.body) {
        hierarchy.push({
          tag: curr.tagName.toLowerCase(),
          className: curr.className,
          id: curr.id,
          dataAttrs: Array.from(curr.attributes)
            .filter(a => a.name.startsWith('data-') || a.name === 'role' || a.name === 'href')
            .map(a => `${a.name}="${a.value}"`)
        });
        curr = curr.parentElement;
      }
      return hierarchy;
    });
  });

  console.log('DOM Hierarchy for card elements:');
  console.log(JSON.stringify(info, null, 2));
}

inspectDOM().catch(console.error);
