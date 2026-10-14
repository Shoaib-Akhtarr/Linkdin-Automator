const { chromium } = require('playwright');
const fs = require('fs');

async function diagnose() {
  console.log('Connecting to Chrome CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log('Open pages:', pages.length);

  for (let i = 0; i < pages.length; i++) {
    console.log(`Page [${i}]: ${pages[i].url()}`);
  }

  // Pick or open LinkedIn page
  let page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];
  console.log('Using page:', page.url());

  // Let's test a search query directly
  const testUrl = 'https://www.linkedin.com/jobs/search/?keywords=AI%20Engineer&f_AL=true';
  console.log('Navigating to test search:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Take screenshot
  await page.screenshot({ path: 'scripts/debug_search.png' });
  console.log('Saved screenshot to scripts/debug_search.png');

  // Inspect page title and url
  console.log('Current URL:', page.url());
  console.log('Page Title:', await page.title());

  // Check for common LinkedIn job elements
  const selectors = [
    '.jobs-search-results-list',
    '.scaffold-layout__list-container',
    'li[data-occludable-job-id]',
    'div.job-card-container',
    'div[data-job-id]',
    'div[data-view-name="job-card"]',
    'a[href*="/jobs/view/"]',
    '.jobs-search-no-results-banner'
  ];

  for (const s of selectors) {
    const count = await page.$$eval(s, els => els.length).catch(() => 0);
    console.log(`Selector "${s}": ${count} matches found`);
  }

  // Let's extract any job links found on the page
  const jobLinks = await page.$$eval('a[href*="/jobs/view/"]', links => {
    return links.slice(0, 10).map(a => ({
      text: a.innerText.replace(/\n+/g, ' ').trim(),
      href: a.href
    }));
  }).catch(() => []);

  console.log('Sample job links found:', jobLinks);
}

diagnose().catch(console.error);
