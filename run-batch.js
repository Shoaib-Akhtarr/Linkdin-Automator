/**
 * Headless CLI Batch Runner for GitHub Actions / Cloud Cron Autopilot
 * Applies to a target batch of jobs (default: 10), generates tailored CVs,
 * saves application records, and terminates cleanly.
 */

process.env.HEADLESS_MODE = 'true';
process.env.RUN_IN_CLOUD = 'true';

const browserBridge = require('./engine/browserBridge');
const orchestrator = require('./engine/orchestrator');
const tracker = require('./engine/tracker');

const fs = require('fs');

function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
    } catch (e) {}
  }
}

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const MAX_TIMEOUT_MINUTES = parseInt(process.env.MAX_TIMEOUT_MINUTES || '25', 10);

async function runBatch() {
  console.log('\n======================================================');
  console.log('🤖 LinkedIn Automator: Headless Cloud Batch Runner');
  console.log(`🎯 Target Batch Size: ${BATCH_SIZE} jobs`);
  console.log(`⏱ Maximum Run Timeout: ${MAX_TIMEOUT_MINUTES} minutes`);
  console.log('======================================================\n');

  if (!process.env.LI_AT_COOKIE || !process.env.LI_AT_COOKIE.trim()) {
    console.error('❌ FATAL: LI_AT_COOKIE environment variable is not defined.');
    console.error('👉 Please set LI_AT_COOKIE in your GitHub Secrets or environment!');
    writeSummary(`### ❌ Missing \`LI_AT_COOKIE\` Secret\nThe **LI_AT_COOKIE** secret is missing or empty in GitHub Secrets.\n\nPlease go to **Settings -> Secrets and variables -> Actions -> New repository secret** and add your **LI_AT_COOKIE**.`);
    process.exit(1);
  }

  // Safety watchdog timer to prevent runner hangs
  const watchdog = setTimeout(async () => {
    console.error(`\n⚠️ Safety timeout reached (${MAX_TIMEOUT_MINUTES} mins). Gracefully shutting down...`);
    await browserBridge.disconnect();
    process.exit(0);
  }, MAX_TIMEOUT_MINUTES * 60 * 1000);

  try {
    console.log('🌐 Step 1: Connecting headless browser...');
    const page = await browserBridge.connect();

    console.log('🔍 Step 2: Verifying LinkedIn session...');
    try {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navErr) {
      if (navErr.message.includes('ERR_TOO_MANY_REDIRECTS')) {
        console.error('❌ LinkedIn session cookie expired or invalid (ERR_TOO_MANY_REDIRECTS).');
        writeSummary(`### ❌ LinkedIn Session Expired / Logged Out\nLinkedIn rejected the session cookie with \`ERR_TOO_MANY_REDIRECTS\`.\n\n👉 **How to Fix:**\n1. Log back in to LinkedIn in your Google Chrome browser.\n2. In terminal, run: \`node scripts/get-cookie.js\`\n3. Copy the fresh cookie and update the **LI_AT_COOKIE** secret in GitHub.`);
        await browserBridge.disconnect();
        process.exit(1);
      }
      throw navErr;
    }
    await browserBridge.humanDelay(2000, 3000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      console.error('❌ LinkedIn session authentication failed.');
      console.error(`Current URL: ${currentUrl}`);
      console.error('👉 Your li_at cookie may be expired. Please run "node scripts/get-cookie.js" and update GitHub Secrets.');
      writeSummary(`### ❌ LinkedIn Session Verification Failed\nLinkedIn redirected to: \`${currentUrl}\`\n\nYour \`li_at\` cookie may be invalid or expired. Please run \`node scripts/get-cookie.js\` locally and update the **LI_AT_COOKIE** secret in GitHub.`);
      await browserBridge.disconnect();
      process.exit(1);
    }

    console.log('✅ LinkedIn session verified successfully! Authenticated as active user.');

    // Configure Orchestrator for Headless Batch
    orchestrator.reloadSettings();
    orchestrator.settings.mode = 'auto'; // Fully autonomous, no manual review prompt in CI
    orchestrator.settings.autopilot = {
      enabled: true,
      batchSize: BATCH_SIZE
    };

    // Forward logs to stdout
    orchestrator.on('log', entry => {
      console.log(`[${entry.type.toUpperCase()}] ${entry.message}`);
    });

    console.log(`\n🚀 Step 3: Starting Autopilot cycle for ${BATCH_SIZE} jobs...`);
    
    let finished = false;
    orchestrator.once('cycle_finished', (data) => {
      console.log(`\n🎉 Cycle Finished Event received: ${data.applied} jobs applied in this batch.`);
      finished = true;
    });

    await orchestrator.start();

    // Wait until orchestrator finishes batch or goes idle
    const startTime = Date.now();
    while (!finished && orchestrator.state === 'running') {
      await new Promise(r => setTimeout(r, 3000));
      // Fallback check
      if (orchestrator.state === 'idle') {
        break;
      }
    }

    clearTimeout(watchdog);

    console.log('\n======================================================');
    console.log('📊 Cloud Batch Execution Completed!');
    const stats = tracker.getStats(orchestrator.settings.dailyLimit || 50);
    console.log(`Total Tracked: ${stats.totalTracked}`);
    console.log(`Total Applied Today: ${stats.todayApplied}`);
    console.log(`Skipped: ${stats.skipped} | Failed: ${stats.failed}`);
    console.log('======================================================\n');

    // Send 2-Hour Email Report
    try {
      const emailNotifier = require('./engine/emailNotifier');
      const allApps = tracker.getAllApplications();
      const cycleApplied = allApps.filter(a => a.status === 'applied' && a.appliedAt && new Date(a.appliedAt).getTime() >= startTime);
      await emailNotifier.sendReport({
        cycleTime: new Date().toLocaleString(),
        batchApplied: cycleApplied.length,
        batchSkipped: stats.skipped,
        totalAppliedToday: stats.todayApplied,
        dailyLimit: orchestrator.settings.dailyLimit || 50,
        appliedJobs: cycleApplied
      });
      writeSummary(`### ✅ 24/7 LinkedIn Autopilot Batch Completed!\n* **Jobs Applied in this Cycle:** ${cycleApplied.length}\n* **Today's Running Total:** ${stats.todayApplied} / ${orchestrator.settings.dailyLimit || 50}\n* **Jobs Skipped / Filtered:** ${stats.skipped}\n* **Email Report:** Sent to \`${process.env.EMAIL_TO || 'onlyshoaib158@gmail.com'}\``);
    } catch (e) {
      console.error('Email report error:', e.message);
    }

    await browserBridge.disconnect();
    process.exit(0);

  } catch (err) {
    clearTimeout(watchdog);
    console.error('❌ Critical Error during batch execution:', err);
    writeSummary(`### ❌ Critical Execution Error\n\`\`\`\n${err.stack || err.message}\n\`\`\``);
    await browserBridge.disconnect();
    process.exit(1);
  }
}

runBatch();
