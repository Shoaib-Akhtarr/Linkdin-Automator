const browserBridge = require('../engine/browserBridge');
const SearchEngine = require('../engine/searchEngine');
const fs = require('fs');
const path = require('path');

async function testFlow() {
  console.log('Connecting to Chrome...');
  const page = await browserBridge.connect();

  const searchEngine = new SearchEngine(browserBridge);
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf-8'));

  console.log('Running navigateToSearch for "AI Engineer"...');
  const jobs = await searchEngine.navigateToSearch('AI Engineer', settings, msg => console.log('LOG:', msg));

  console.log(`\n========================================`);
  console.log(`Successfully found ${jobs.length} Easy Apply listings!`);
  console.log(`Sample listings:`);
  jobs.slice(0, 5).forEach((j, i) => {
    console.log(`[${i+1}] ${j.title} | ${j.company} | ${j.location} (EasyApply: ${j.hasEasyApply})`);
  });
  console.log(`========================================\n`);

  if (jobs.length > 0) {
    console.log('Testing selectJob on first job...');
    const selected = await searchEngine.selectJob(page, jobs[0], msg => console.log('LOG:', msg));
    console.log('Job selected result:', selected);
  }
}

testFlow().catch(console.error);
