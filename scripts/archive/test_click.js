const { chromium } = require('playwright');

async function testClickAndApply() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  // Click the first card
  const cards = await page.$$('[data-testid="lazy-column"] div[role="button"]');
  console.log(`Clicking card 0 out of ${cards.length}...`);
  await cards[0].click();
  await page.waitForTimeout(2500);

  // Check right pane for Easy Apply button
  const buttons = await page.$$eval('button', btns => {
    return btns.map(b => ({
      text: (b.innerText || '').trim(),
      ariaLabel: b.getAttribute('aria-label') || '',
      className: b.className
    })).filter(b => b.text.toLowerCase().includes('easy apply') || b.ariaLabel.toLowerCase().includes('easy apply'));
  });

  console.log('Easy Apply buttons found in details pane:');
  console.log(JSON.stringify(buttons, null, 2));

  // Take screenshot of selected job
  await page.screenshot({ path: 'scripts/debug_card_click.png' });
  console.log('Saved screenshot to scripts/debug_card_click.png');
}

testClickAndApply().catch(console.error);
