/**
 * run-cloud-autopilot.js — Headless Cloud Batch Runner
 * 
 * Executed by GitHub Actions on scheduled runs or mobile dispatch.
 * Runs 1 batch cycle (up to BATCH_SIZE applications or until daily limit),
 * saves tracking history, and exits cleanly.
 */

'use strict';

require('../engine/envLoader');
const orchestrator = require('../engine/orchestrator');
const tracker = require('../engine/tracker');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const TIMEOUT_MINUTES = parseInt(process.env.TIMEOUT_MINUTES || '25', 10);

console.log('================================================================');
console.log('🚀 [CLOUD RUNNER] LinkedIn Autopilot Batch Sweep');
console.log(`🎯 Target Batch Size: ${BATCH_SIZE} applications`);
console.log(`⏱ Maximum Run Duration: ${TIMEOUT_MINUTES} minutes`);
console.log(`🌐 Proxy Server: ${process.env.PROXY_SERVER || 'Direct'}`);
console.log(`🔑 LI_AT Session: ${process.env.LI_AT_COOKIE ? 'Provided (Length ' + process.env.LI_AT_COOKIE.length + ')' : 'MISSING!'}`);
console.log('================================================================\n');

if (!process.env.LI_AT_COOKIE && !process.env.LINKEDIN_COOKIES) {
  console.error('❌ ERROR: LI_AT_COOKIE secret is missing! Please configure it in GitHub Repository Secrets.');
  process.exit(1);
}

// Timeout guard
const timeoutTimer = setTimeout(async () => {
  console.warn(`\n⏱ Reached maximum runtime (${TIMEOUT_MINUTES}m). Shutting down cycle cleanly...`);
  try { await orchestrator.stop(); } catch (_) {}
  process.exit(0);
}, TIMEOUT_MINUTES * 60 * 1000);

let initialAppliedCount = 0;

orchestrator.on('log', (entry) => {
  console.log(`[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}`);
});

orchestrator.on('stats_update', (stats) => {
  const currentBatch = (stats.sessionAppliedCount || 0);
  if (currentBatch >= BATCH_SIZE) {
    console.log(`\n🎉 Target batch of ${BATCH_SIZE} applications completed! Exiting cleanly.`);
    clearTimeout(timeoutTimer);
    orchestrator.stop().then(() => {
      process.exit(0);
    });
  }
});

(async () => {
  try {
    const status = orchestrator.getStatus();
    initialAppliedCount = status.stats?.todayApplied || 0;

    console.log(`📊 Today's current applied count: ${initialAppliedCount}/100`);
    if (initialAppliedCount >= 100) {
      console.log('✅ Daily limit of 100 reached. No further applications needed today.');
      process.exit(0);
    }

    // Start 1 sweep
    await orchestrator.start();
  } catch (err) {
    console.error('❌ Cloud Runner fatal error:', err);
    clearTimeout(timeoutTimer);
    try { await orchestrator.stop(); } catch (_) {}
    process.exit(1);
  }
})();
