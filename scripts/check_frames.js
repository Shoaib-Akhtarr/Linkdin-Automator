const { chromium } = require('playwright');

async function checkFrames() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const frames = page.frames();
  console.log('Total frames:', frames.length);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    console.log(`\nFrame [${i}]: ${frame.url() || 'about:blank'}`);
    const nextBtn = await frame.$('button:has-text("Next")');
    console.log(`Frame [${i}] has Next button?`, !!nextBtn);

    const hasApply = await frame.evaluate(() => {
      return document.body ? document.body.innerText.includes('Apply to') : false;
    }).catch(() => false);
    console.log(`Frame [${i}] text includes 'Apply to'?`, hasApply);
  }
}

checkFrames().catch(console.error);
