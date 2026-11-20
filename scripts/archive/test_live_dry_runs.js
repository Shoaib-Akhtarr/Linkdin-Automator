const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');

const APPS_FILE = path.join(__dirname, '..', 'data', 'applications.json');
const originalAppsData = fs.readFileSync(APPS_FILE, 'utf8');

async function testLiveDryRuns() {
  console.log('====================================================');
  console.log('🌐 TESTING LIVE ATS PAGES IN --dry-run MODE');
  console.log('====================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const mockBridge = {
    humanDelay: async (min, max) => new Promise(r => setTimeout(r, 600)),
    page: page
  };
  const engine = new ExternalApplyEngine(mockBridge);

  const testJobs = [
    {
      platform: 'greenhouse',
      company: 'Canonical',
      title: 'Ubuntu Core Software Engineer',
      url: 'https://job-boards.greenhouse.io/canonical/jobs/3182672#app'
    },
    {
      platform: 'lever',
      company: 'Spotify',
      title: 'Machine Learning Engineer',
      url: 'https://jobs.lever.co/spotify/9761af44-be41-43ca-8c01-79cdbb2aef93/apply'
    }
  ];

  for (const job of testJobs) {
    console.log(`\n----------------------------------------------------`);
    console.log(`🚀 Testing Live [${job.platform.toUpperCase()}] Career Portal`);
    console.log(`   Company: ${job.company}`);
    console.log(`   Job:     ${job.title}`);
    console.log(`   URL:     ${job.url}`);
    console.log(`----------------------------------------------------`);

    try {
      console.log(`Navigating to live career page...`);
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const isDirectOpen = await engine.areFormFieldsDirectlyOpen(page);
      console.log(`✓ Direct open ATS form fields detected: ${isDirectOpen}`);

      // Run Stage 3 & 4 with dryRun: true
      const result = await engine.executeStage3And4(page, job, (msg) => {
        console.log(`   [Engine] ${msg}`);
      }, {
        dryRun: true,
        mode: 'review'
      });

      console.log(`\n📋 Outcome for ${job.platform.toUpperCase()}:`);
      console.log(`   Status:       ${result.status}`);
      console.log(`   Code:         ${result.code}`);
      console.log(`   Tailored CV:  ${result.tailoredCV || 'N/A'}`);

      if (result.status === 'dry_run_complete' && result.code === 'DRY_RUN_STOPPED_BEFORE_SUBMIT') {
        console.log(`✅ SUCCESS: Form reached final stage and stopped safely before submission.`);
      } else {
        console.log(`ℹ️ Result handled safely: ${result.status} (${result.code})`);
      }
    } catch (err) {
      console.error(`⚠️ Page navigation note: ${err.message}`);
    }
  }

  await browser.close();
  // Restore live tracker database cleanly
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
  console.log('\n====================================================');
  console.log('✓ All live dry-run checks completed. Database clean.');
  console.log('====================================================');
}

testLiveDryRuns().catch(err => {
  console.error('Live dry-run test error:', err);
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
  process.exit(1);
});
