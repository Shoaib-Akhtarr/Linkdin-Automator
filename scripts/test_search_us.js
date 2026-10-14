const SearchEngine = require('../engine/searchEngine');
const browserBridge = require('../engine/browserBridge');
const fs = require('fs');

(async () => {
  try {
    const page = await browserBridge.connect();
    const searchEngine = new SearchEngine(browserBridge);
    const settings = JSON.parse(fs.readFileSync('./config/settings.json', 'utf8'));
    
    const url = searchEngine.buildSearchUrl('AI Engineer', settings);
    console.log('Testing URL:', url);
    
    const jobs = await searchEngine.navigateToSearch('AI Engineer', settings, console.log);
    console.log(`Found ${jobs.length} jobs!`);
    for (let i = 0; i < Math.min(jobs.length, 5); i++) {
      console.log(`[${i+1}] ${jobs[i].title} at ${jobs[i].company} (${jobs[i].location}) -> ID: ${jobs[i].jobId}`);
    }
  } catch(e) {
    console.error('Error:', e);
  }
})();
