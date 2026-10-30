/**
 * run-cloud-autopilot.js — Headless Cloud Batch Runner
 * 
 * Executed by GitHub Actions on scheduled runs or mobile dispatch.
 * Runs 1 batch cycle (up to BATCH_SIZE applications or until daily limit),
 * emits real-time telemetry to the connected mobile app,
 * dispatches the final session email report, saves tracking history, and exits cleanly.
 */

'use strict';

require('../engine/envLoader');
const http = require('http');
const orchestrator = require('../engine/orchestrator');
const tracker = require('../engine/tracker');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const TIMEOUT_MINUTES = parseInt(process.env.TIMEOUT_MINUTES || '235', 10);
const PROXY_PORT = process.env.PROXY_PORT || '9050';

console.log('================================================================');
console.log('🚀 [CLOUD RUNNER] LinkedIn Autopilot Batch Sweep');
console.log(`🎯 Target Batch Size: ${BATCH_SIZE} applications`);
console.log(`⏱ Maximum Run Duration: ${TIMEOUT_MINUTES} minutes (Workflow Limit: 240m)`);
console.log(`🌐 Proxy Server: ${process.env.PROXY_SERVER || 'Direct'}`);
console.log(`🔑 LI_AT Session: ${process.env.LI_AT_COOKIE ? 'Provided (Length ' + process.env.LI_AT_COOKIE.length + ')' : 'MISSING!'}`);
console.log(`🧠 Groq AI Optimizer: ${process.env.GROQ_API_KEY ? 'ACTIVATED ✓ (qwen/qwen3.8-27b)' : 'NOT CONFIGURED (Falling back to deterministic tailor)'}`);
console.log(`📧 Email Notifier: ${process.env.EMAIL_PASS ? 'READY ✓ (Recipient: ' + (process.env.EMAIL_TO || process.env.EMAIL_USER) + ')' : 'NOT CONFIGURED (EMAIL_PASS secret missing)'}`);
console.log('================================================================\n');

if (!process.env.LI_AT_COOKIE && !process.env.LINKEDIN_COOKIES) {
  console.error('❌ ERROR: LI_AT_COOKIE secret is missing! Please configure it in GitHub Repository Secrets.');
  process.exit(1);
}

/**
 * Forward telemetry event to local proxy -> cloud relay -> mobile app
 */
function sendMobileTelemetry(data) {
  try {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PROXY_PORT,
      path: '/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 2000
    });
    req.on('error', () => {}); // Ignore if proxy not ready
    req.write(postData);
    req.end();
  } catch (_) {}
}

let isExiting = false;
async function gracefulExit(reason) {
  if (isExiting) return;
  isExiting = true;

  console.log(`\n🛑 [Shutdown] ${reason}. Finalizing session report & tracker...`);
  sendMobileTelemetry({
    event: 'workflow_finished',
    reason,
    timestamp: new Date().toLocaleTimeString()
  });

  try {
    // Stop orchestrator and trigger email report cleanly
    await orchestrator.stop();
  } catch (err) {
    console.error('Error stopping orchestrator:', err);
  }

  // Explicit safety check: ensure email report is sent even if stop() had an issue
  try {
    await orchestrator.sendEmailReport(false);
  } catch (_) {}

  console.log('✅ Final session summary report processed.');
  process.exit(0);
}

// Timeout guard
const timeoutTimer = setTimeout(() => {
  gracefulExit(`Reached maximum runtime (${TIMEOUT_MINUTES}m)`);
}, TIMEOUT_MINUTES * 60 * 1000);

let initialAppliedCount = 0;

orchestrator.on('log', (entry) => {
  console.log(`[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}`);
  sendMobileTelemetry({
    event: 'log',
    log: entry
  });
});

orchestrator.on('current_job', (job) => {
  if (job) {
    console.log(`\n💼 [CURRENT JOB] ${job.title} at ${job.company} (${job.location || 'Remote'})`);
  }
  sendMobileTelemetry({
    event: 'current_job',
    job: job ? {
      title: job.title,
      company: job.company,
      location: job.location,
      time: new Date().toLocaleTimeString()
    } : null
  });
});

orchestrator.on('stats_update', (stats) => {
  const currentBatch = (stats.sessionAppliedCount || 0);
  sendMobileTelemetry({
    event: 'stats_update',
    batchApplied: currentBatch,
    todayApplied: stats.todayApplied,
    dailyLimit: stats.dailyLimit,
    remaining: stats.remainingToday
  });

  if (currentBatch >= BATCH_SIZE) {
    console.log(`\n🎉 Target batch of ${BATCH_SIZE} applications completed! Exiting cleanly.`);
    clearTimeout(timeoutTimer);
    gracefulExit(`Target batch of ${BATCH_SIZE} applications achieved`);
  }
});

(async () => {
  try {
    const status = orchestrator.getStatus();
    initialAppliedCount = status.stats?.todayApplied || 0;

    console.log(`📊 Today's current applied count: ${initialAppliedCount}/100`);
    sendMobileTelemetry({
      event: 'workflow_started',
      batchSize: BATCH_SIZE,
      todayApplied: initialAppliedCount,
      timestamp: new Date().toLocaleTimeString()
    });

    if (initialAppliedCount >= 100) {
      console.log('✅ Daily limit of 100 reached. No further applications needed today.');
      await gracefulExit('Daily limit of 100 already reached');
      return;
    }

    // Start 1 sweep
    await orchestrator.start();

    // If loop finished on its own
    await gracefulExit('Batch sweep completed');
  } catch (err) {
    console.error('❌ Cloud Runner fatal error:', err);
    clearTimeout(timeoutTimer);
    await gracefulExit(`Fatal error: ${err.message}`);
  }
})();
