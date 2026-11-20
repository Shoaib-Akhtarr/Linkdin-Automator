const { chromium } = require('playwright');

async function inspectModalDOM() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

  const info = await page.evaluate(() => {
    // Find the Next button
    const allButtons = Array.from(document.querySelectorAll('button'));
    const nextBtn = allButtons.find(b => (b.innerText || '').trim() === 'Next');

    let buttonInfo = null;
    let modalParent = null;

    if (nextBtn) {
      buttonInfo = {
        text: nextBtn.innerText,
        className: nextBtn.className,
        id: nextBtn.id,
        attributes: Array.from(nextBtn.attributes).map(a => `${a.name}="${a.value}"`)
      };

      // Walk up to find the container
      let curr = nextBtn;
      const path = [];
      while (curr && curr !== document.body) {
        path.push({
          tag: curr.tagName.toLowerCase(),
          className: curr.className,
          id: curr.id,
          role: curr.getAttribute('role'),
          attributes: Array.from(curr.attributes)
            .filter(a => a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-modal' || a.name === 'id')
            .map(a => `${a.name}="${a.value}"`)
        });
        curr = curr.parentElement;
      }
      modalParent = path;
    }

    // Also look for the header "Apply to"
    const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span'))
      .filter(el => (el.innerText || '').includes('Apply to'));

    return {
      nextButtonFound: !!nextBtn,
      buttonInfo,
      modalParent,
      headers: headers.map(h => ({ tag: h.tagName, text: h.innerText, class: h.className }))
    };
  });

  console.log('Inspection Result:');
  console.log(JSON.stringify(info, null, 2));
}

inspectModalDOM().catch(console.error);
