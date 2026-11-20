/**
 * Audit Script: Verify Application Limits, 90-Day Deduplication & 1-per-platform Quota
 */

const tracker = require('../engine/tracker');
const fs = require('fs');
const path = require('path');

async function runLimitationsAudit() {
  console.log('================================================================');
  console.log('🔍 AUDITING APPLICATION LIMITS & DEDUPLICATION CIRCUITS');
  console.log('================================================================\n');

  // 1. SETTINGS AUDIT
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf8'));
  console.log('1. Active Settings Limits:');
  console.log(`   - execution.dailyApplicationLimit: ${settings.execution?.dailyApplicationLimit} apps/day`);
  console.log(`   - execution.maxPerCategory:        ${settings.execution?.maxPerCategory} apps per platform/category`);
  console.log(`   - autopilot.batchSize:             ${settings.autopilot?.batchSize} apps per autopilot cycle`);
  console.log(`   - autopilot.intervalMinutes:       ${settings.autopilot?.intervalMinutes} minutes between cycles`);

  // 2. DAILY TRACKER STATS
  const stats = tracker.getStats(settings.execution?.dailyApplicationLimit || 100);
  console.log('\n2. Current Ledger Stats:');
  console.log(`   - Total Applications in DB:        ${stats.totalTracked}`);
  console.log(`   - Applied Today:                   ${stats.todayApplied}`);
  console.log(`   - Remaining Daily Quota:           ${stats.remainingToday}`);
  console.log(`   - Is Daily Limit Reached?          ${tracker.isDailyLimitReached(settings.execution?.dailyApplicationLimit || 100)}`);

  // 3. 90-DAY DEDUPLICATION AUDIT
  console.log('\n3. Verifying 90-Day Pre-Flight Deduplication Logic:');
  
  // Test Case A: Job applied 10 days ago (< 90 days) -> MUST SKIP
  const recentJob = {
    jobId: 'test_job_applied_recently',
    company: 'Anthropic AI Test',
    title: 'Senior RLHF Engineer',
    status: 'applied',
    appliedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
  };
  tracker.data.applications.push(recentJob);
  const evalRecent = tracker.evaluatePreFlightClass(recentJob);
  console.log(`   Case A (Applied 10d ago): Action="${evalRecent.action}", Class="${evalRecent.class}", Reason="${evalRecent.reason}"`);
  console.log(`      ✓ 90-Day Skip Active? ${evalRecent.action === 'SKIP' && evalRecent.class === 'DONE'}`);

  // Test Case B: Job applied 95 days ago (> 90 days) -> ALLOW RE-APPLY (CLEAR)
  const oldJob = {
    jobId: 'test_job_applied_long_ago',
    company: 'OpenAI Test',
    title: 'Research Scientist',
    status: 'applied',
    appliedAt: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString() // 95 days ago
  };
  tracker.data.applications.push(oldJob);
  const evalOld = tracker.evaluatePreFlightClass(oldJob);
  console.log(`   Case B (Applied 95d ago): Action="${evalOld.action}", Class="${evalOld.class}"`);
  console.log(`      ✓ Expired 90-day cooldown allows re-apply? ${evalOld.action === 'PROCEED' && evalOld.class === 'CLEAR'}`);

  // Clean up test records in memory
  tracker.data.applications = tracker.data.applications.filter(
    a => a.jobId !== 'test_job_applied_recently' && a.jobId !== 'test_job_applied_long_ago'
  );

  // 4. PLATFORM LIMIT (maxPerCategory) AUDIT
  console.log('\n4. Verifying "maxPerCategory" Platform Quota Circuit:');
  const maxPerCat = parseInt(settings.execution?.maxPerCategory || '0', 10);
  console.log(`   Configured maxPerCategory: ${maxPerCat}`);
  if (maxPerCat === 1) {
    console.log('   ⚠️ WARNING: maxPerCategory is set to 1!');
    console.log('      This means the engine will apply to only ONE job per platform (1 LinkedIn, 1 Ashby, 1 Greenhouse, 1 Wellfound) before switching or stopping!');
  } else if (maxPerCat === 0) {
    console.log('   ✓ maxPerCategory is 0 (UNLIMITED per platform up to daily limit).');
  } else {
    console.log(`   ✓ maxPerCategory allows up to ${maxPerCat} applications per platform.`);
  }

  console.log('\n================================================================');
  console.log('🏁 AUDIT COMPLETE');
  console.log('================================================================');
}

runLimitationsAudit().catch(console.error);
