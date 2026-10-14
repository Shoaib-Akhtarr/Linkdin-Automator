const { chromium } = require('playwright');

async function inspectButtons() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const btns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: (b.innerText || '').trim(),
      ariaLabel: b.getAttribute('aria-label') || '',
      className: b.className,
      id: b.id,
      dataAttrs: Array.from(b.attributes)
        .filter(a => a.name.startsWith('data-'))
        .map(a => `${a.name}="${a.value}"`)
    })).filter(b => b.text.length > 0 || b.ariaLabel.length > 0);
  });

  console.log(`Found ${btns.length} buttons on page:`);
  console.log(JSON.stringify(btns, null, 2));
}

inspectButtons().catch(console.error);
