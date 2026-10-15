const browserBridge = require('../engine/browserBridge');

async function test() {
  console.log('Testing browser bridge launch...');
  const page = await browserBridge.getPage();
  console.log('Browser connected. Navigating to LinkedIn jobs...');
  await page.goto('https://www.linkedin.com/jobs/search/?keywords=AI+Engineer&f_WT=2&f_TPR=r2592000', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  console.log('Navigated successfully! URL:', page.url());
  console.log('Title:', await page.title());
  const loggedIn = await browserBridge.isLinkedInLoggedIn();
  console.log('Is logged in:', loggedIn);
  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
