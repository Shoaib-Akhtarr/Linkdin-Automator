const { chromium } = require('playwright');
const fs = require('fs');

async function testSelectResumeAndNext() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  // Check if any resume radio button is present
  const radios = await page.$$('dialog input[type="radio"], [data-testid="dialog"] input[type="radio"]');
  console.log(`Found ${radios.length} resume radio buttons.`);
  if (radios.length > 0) {
    // Check if any is already checked
    let anyChecked = false;
    for (const r of radios) {
      if (await r.isChecked()) { anyChecked = true; break; }
    }
    if (!anyChecked) {
      console.log('Selecting first resume option...');
      await radios[0].click({ force: true });
      await page.waitForTimeout(1000);
    }
  }

  // Click Next
  const nextBtn = await page.$('dialog button:has-text("Next"), [data-testid="dialog"] button:has-text("Next"), button:has-text("Next")');
  if (nextBtn) {
    console.log('Clicking Next...');
    await nextBtn.click({ force: true });
    await page.waitForTimeout(3000);

    const cdp = await context.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    fs.writeFileSync('scripts/after_resume_next.jpg', Buffer.from(data, 'base64'));
    console.log('Saved screenshot to scripts/after_resume_next.jpg');
  }
}

testSelectResumeAndNext().catch(console.error);
