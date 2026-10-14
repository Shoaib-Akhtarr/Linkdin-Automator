const { chromium } = require('playwright');
const fs = require('fs');

async function testClickEasyApplyAndInspect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  console.log('Finding Easy Apply button...');
  const btn = await page.$('button[aria-label*="Easy Apply"], button:has-text("Easy Apply")');
  if (!btn) {
    console.log('No Easy Apply button visible right now. Current page URL:', page.url());
    return;
  }

  console.log('Clicking Easy Apply button...');
  await btn.click({ force: true });
  await page.waitForTimeout(3000);

  // Take screenshot
  const cdp = await context.newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  fs.writeFileSync('scripts/after_click_easy_apply.jpg', Buffer.from(data, 'base64'));
  console.log('Saved screenshot to scripts/after_click_easy_apply.jpg');

  // Now inspect ALL visible buttons
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => {
      const rect = b.getBoundingClientRect();
      return {
        text: (b.innerText || '').trim(),
        ariaLabel: b.getAttribute('aria-label') || '',
        visible: rect.width > 0 && rect.height > 0,
        className: b.className
      };
    }).filter(b => b.visible && (b.text || b.ariaLabel));
  });

  console.log('Visible buttons after clicking Easy Apply:');
  console.log(JSON.stringify(buttons, null, 2));

  // Find the container enclosing "Contact info" or "Apply to"
  const containerInfo = await page.evaluate(() => {
    const textEls = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && (el.innerText || '').includes('Contact info');
    });
    if (textEls.length === 0) return null;

    let curr = textEls[0];
    const path = [];
    while (curr && curr !== document.body) {
      path.push({
        tag: curr.tagName.toLowerCase(),
        id: curr.id,
        className: curr.className,
        role: curr.getAttribute('role'),
        ariaModal: curr.getAttribute('aria-modal'),
        dataAttrs: Array.from(curr.attributes)
          .filter(a => a.name.startsWith('data-'))
          .map(a => `${a.name}="${a.value}"`)
      });
      curr = curr.parentElement;
    }
    return path;
  });

  console.log('Modal Container Hierarchy for "Contact info":');
  console.log(JSON.stringify(containerInfo, null, 2));
}

testClickEasyApplyAndInspect().catch(console.error);
