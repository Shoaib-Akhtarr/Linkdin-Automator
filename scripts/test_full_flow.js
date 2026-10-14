const browserBridge = require('../engine/browserBridge');
const SearchEngine = require('../engine/searchEngine');
const EasyApplyModal = require('../engine/easyApplyModal');
const fs = require('fs');

(async () => {
  try {
    const page = await browserBridge.connect();
    const searchEngine = new SearchEngine(browserBridge);
    const easyApplyModal = new EasyApplyModal(browserBridge);
    const settings = JSON.parse(fs.readFileSync('./config/settings.json', 'utf8'));

    console.log('Extracting candidate jobs...');
    const jobs = await searchEngine.navigateToSearch('AI Engineer', settings, console.log);
    console.log(`Found ${jobs.length} candidate jobs.`);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      console.log(`\n[Job ${i+1}/${jobs.length}] Checking: "${job.title}" at "${job.company}"`);
      
      const selected = await searchEngine.selectJob(page, job, console.log);
      if (!selected) continue;

      const applyStatus = await searchEngine.clickEasyApplyButton(page, console.log);
      console.log('Easy Apply status:', applyStatus);
      if (!applyStatus || applyStatus === 'already_applied') {
        console.log('Skipping (not Easy Apply or already applied).');
        continue;
      }

      console.log('>>> Found Easy Apply job! Starting modal test in Hybrid Mode...');
      const result = await easyApplyModal.handleModal(job, {
        mode: 'hybrid',
        onStatusUpdate: console.log
      });

      console.log('\nResult of handleModal:', result);
      await page.screenshot({ path: 'scripts/full_flow_result.jpg' });
      console.log('Saved screenshot to scripts/full_flow_result.jpg');

      console.log('Dismissing test dialog cleanly...');
      await easyApplyModal.dismissModal(page);
      console.log('Done test on this job.');
      break;
    }
  } catch(e) {
    console.error('Error in full flow test:', e);
  }
})();
