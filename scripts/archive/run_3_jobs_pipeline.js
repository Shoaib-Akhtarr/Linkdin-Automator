const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');
const tracker = require('../engine/tracker');

async function runThreeJobs() {
  console.log('================================================================');
  console.log('🚀 EXECUTING 3-JOB BATCH RUN: LIVE ATS PIPELINE & ERROR RECOVERY');
  console.log('================================================================\n');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  const mockBridge = {
    humanDelay: async (min, max) => new Promise(r => setTimeout(r, 600)),
    page: page
  };
  const engine = new ExternalApplyEngine(mockBridge);

  const jobsToRun = [
    {
      id: 'job-1-greenhouse',
      platform: 'greenhouse',
      company: 'Canonical (Ubuntu)',
      title: 'Ubuntu Core Software Engineer',
      url: 'https://job-boards.greenhouse.io/canonical/jobs/3182672#app',
      expectedType: 'SUCCESS_DRY_RUN'
    },
    {
      id: 'job-2-ashby',
      platform: 'ashby',
      company: 'Deepgram',
      title: 'Embedded AI Engineer, On-Device Models',
      url: 'https://jobs.ashbyhq.com/deepgram/0b7494b3-a91e-4540-9439-5b10a1e5b391',
      expectedType: 'SUCCESS_DRY_RUN'
    },
    {
      id: 'job-3-error-unreachable',
      platform: 'greenhouse',
      company: 'DefunctCorp / Expired Portal',
      title: 'Senior Distributed Systems Architect',
      url: 'https://job-boards.greenhouse.io/canonical/jobs/99999999999#app',
      expectedType: 'ERROR_GRACEFUL_EXIT'
    }
  ];

  const outcomes = [];

  for (let i = 0; i < jobsToRun.length; i++) {
    const job = jobsToRun[i];
    console.log(`\n================================================================`);
    console.log(`▶ BATCH ITEM ${i + 1} OF 3: [${job.platform.toUpperCase()}] "${job.title}" at "${job.company}"`);
    console.log(`  Target URL: ${job.url}`);
    console.log(`================================================================`);

    const startTime = Date.now();
    try {
      const result = await engine.applyDirectUrl(page, job, {
        dryRun: true,
        mode: 'review'
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n⏱️ Execution time: ${elapsed}s`);
      console.log(`📋 Result: status="${result.status}", code="${result.code || 'N/A'}"`);
      if (result.tailoredCV) console.log(`📄 Tailored Resume: ${result.tailoredCV}`);

      outcomes.push({
        job: job.title,
        company: job.company,
        platform: job.platform,
        status: result.status,
        code: result.code,
        cv: result.tailoredCV || 'N/A',
        time: `${elapsed}s`
      });

    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n❌ Caught Pipeline Exception: ${err.message}`);
      outcomes.push({
        job: job.title,
        company: job.company,
        platform: job.platform,
        status: 'exception',
        code: err.message,
        cv: 'N/A',
        time: `${elapsed}s`
      });
    }
  }

  await browser.close();

  console.log('\n================================================================');
  console.log('📊 FINAL 3-JOB BATCH SUMMARY TABLE:');
  console.log('================================================================');
  console.table(outcomes);
  console.log('================================================================');
}

runThreeJobs().catch(err => {
  console.error('Fatal batch runner error:', err);
  process.exit(1);
});
