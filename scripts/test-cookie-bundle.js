const { chromium } = require('playwright');

(async () => {
  try {
    // 1. Get cookies from real Chrome
    const cdpBrowser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const cdpCtx = cdpBrowser.contexts()[0];
    const cookies = await cdpCtx.cookies(['https://www.linkedin.com', 'https://linkedin.com']);
    const sessionCookies = cookies.filter(c => 
      ['li_at', 'JSESSIONID', 'bcookie', 'bscookie', 'li_rm', 'li_sugr', 'lidc'].includes(c.name)
    );
    console.log('Exported', sessionCookies.length, 'session cookies.');

    // 2. Launch fresh headless browser using system Chrome
    const headlessBrowser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const headlessCtx = await headlessBrowser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    await headlessCtx.addCookies(sessionCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith('.') ? c.domain : '.' + c.domain,
      path: c.path || '/',
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite || 'None'
    })));

    const page = await headlessCtx.newPage();
    console.log('Navigating headless page to https://www.linkedin.com/feed/...');
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('SUCCESS! Final URL:', page.url());
    console.log('Page Title:', await page.title());
    await headlessBrowser.close();
  } catch (e) {
    console.error('Headless test error:', e.message);
  }
})();
