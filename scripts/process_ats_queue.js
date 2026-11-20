#!/usr/bin/env node
/**
 * Direct Company ATS Queue Processor
 * Reads pending jobs from data/ats_jobs.json and auto-applies through company portals
 * (Greenhouse, Ashby, Lever) using Chrome on port 9222.
 * 
 * Usage:
 *   node scripts/process_ats_queue.js [--limit 10] [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const browserBridge = require('../engine/browserBridge');
const tracker = require('../engine/tracker');
const ExternalApplyEngine = require('../engine/externalApplyEngine');
const CompanyAtsEngine = require('../engine/platforms/companyAtsEngine');
const eligibilityEngine = require('../engine/eligibilityEngine');
const triAiEvaluator = require('../engine/triAiEvaluator');
const outreachGenerator = require('../engine/outreachGenerator');

const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json');
const ATS_FILE = path.join(ROOT, 'data', 'ats_jobs.json');

function loadJson(p, def = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return def;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  
  const settings = loadJson(SETTINGS_FILE);
  const maxLimit = limitIdx !== -1 && args[limitIdx + 1]
    ? parseInt(args[limitIdx + 1], 10)
    : (settings.execution?.dailyApplicationLimit || 15);
  const minScore = settings.directCompanyAts?.minimumMatchScore || 70;

  console.log('='.repeat(70));
  console.log('🎯 DIRECT COMPANY ATS QUEUE PROCESSOR');
  console.log('='.repeat(70));
  console.log(` • Mode:             ${isDryRun ? 'DRY-RUN (Inspection only)' : 'AUTONOMOUS SUBMIT'}`);
  console.log(` • Batch Limit:      ${maxLimit} applications`);
  console.log(` • Match Threshold:  ${minScore}%`);
  console.log('='.repeat(70));

  const externalApply = new ExternalApplyEngine(browserBridge);
  const companyAts = new CompanyAtsEngine(browserBridge, externalApply);

  const atsData = companyAts.loadAtsJobs();
  const allJobs = atsData.jobs || [];

  const pending = allJobs.filter(j => 
    j.status === 'PENDING_APPROVAL' || 
    j.status === 'auto_queued_for_apply' || 
    j.status === 'approved_queued_for_apply' ||
    j.status === 'alerted_pending_approval'
  );

  console.log(`\nFound ${pending.length} pending candidate job(s) in ATS ledger.\n`);

  if (pending.length === 0) {
    console.log('✓ No pending jobs to process. Run "npm run find-jobs" to discover new openings.');
    process.exit(0);
  }

  // Connect to Chrome if submitting
  let page = null;
  if (!isDryRun) {
    console.log('[*] Connecting to Google Chrome session (Port 9222)...');
    try {
      page = await browserBridge.connect();
      console.log('[+] Connected to Chrome successfully.\n');
    } catch (err) {
      console.error(`[!] Failed to connect to Chrome: ${err.message}`);
      console.error('    Please start Chrome in debug mode first: double-click launch-chrome.bat or run DAILY_RUN.bat option 4.');
      process.exit(1);
    }
  } else {
    console.log('[ℹ️] Dry-run inspection mode: Chrome connection bypassed.\n');
  }

  let processedCount = 0;
  let appliedCount = 0;
  let skippedCount = 0;

  for (const job of pending) {
    if (appliedCount >= maxLimit || (isDryRun && processedCount >= maxLimit)) {
      console.log(`\n🎉 Batch target reached (${isDryRun ? processedCount : appliedCount}/${maxLimit}). Exiting safely.`);
      break;
    }

    processedCount++;
    console.log(`\n[${processedCount}/${pending.length}] Inspecting: "${job.title}" at "${job.company}" (${job.platform?.toUpperCase() || 'ATS'})`);
    console.log(`     URL: ${job.url || job.applyUrl}`);

    // Check duplicate
    const prior = tracker.findPriorApplication(job);
    if (prior && (prior.status === 'applied' || prior.status === 'previously_applied')) {
      console.log('     ↳ Already applied in history. Skipping.');
      job.status = 'applied';
      companyAts.saveAtsJobs(atsData);
      skippedCount++;
      continue;
    }

    // Eligibility check
    const elig = eligibilityEngine.evaluateEligibility(job, settings);
    if (!elig.eligible) {
      console.log(`     ↳ 🛡️ Ineligible: ${elig.reason}. Skipping.`);
      job.status = 'skipped_eligibility';
      job.failureReason = elig.reason;
      companyAts.saveAtsJobs(atsData);
      skippedCount++;
      continue;
    }

    // Tri-AI check
    const aiEval = triAiEvaluator.getCachedEvaluation(job.jobId);
    if (aiEval) {
      if (aiEval.recommendationTier === 'reject' || (typeof aiEval.consensusScore === 'number' && aiEval.consensusScore < 5.0)) {
        console.log(`     ↳ 🛑 Tri-AI Gated: Score ${aiEval.consensusScore}/10 (${aiEval.consensusVerdict}). Skipping.`);
        job.status = 'rejected_by_ai';
        job.failureReason = `Tri-AI: ${aiEval.consensusScore}/10 (${aiEval.consensusVerdict})`;
        companyAts.saveAtsJobs(atsData);
        skippedCount++;
        continue;
      } else {
        console.log(`     ↳ 🧠 Tri-AI Score: ${aiEval.consensusScore}/10 (${aiEval.consensusVerdict})`);
      }
    }

    if (isDryRun) {
      console.log('     ↳ 🧪 [DRY-RUN] Eligible for submission. Skipping click.');
      continue;
    }

    // Apply
    try {
      if (!page || page.isClosed()) {
        page = await browserBridge.getPage();
      }

      console.log('     ↳ 🚀 Launching application sequence...');
      const result = await companyAts.approveAndApply(job.jobId, page, {
        mode: 'autonomous',
        settings,
        onStatusUpdate: msg => console.log(`        ${msg}`)
      });

      if (result && result.status === 'applied') {
        appliedCount++;
        console.log(`     ↳ ✅ Successfully submitted application!`);
        
        // Cold outreach reminder
        try {
          const outreach = outreachGenerator.generateOutreach(job.company, job.title);
          console.log(`     ↳ ✉️ Decision-maker link: ${outreach.links?.findOnLinkedIn || 'N/A'}`);
        } catch (_) {}
      } else {
        console.log(`     ↳ ⚠️ Result status: ${result?.status || 'unsubmitted'} (${result?.message || 'form not completed'})`);
      }

      // Human delay between applications
      const delayMs = Math.floor(Math.random() * 3000) + 2000;
      console.log(`     ↳ Waiting ${Math.round(delayMs / 1000)}s before next job...`);
      await new Promise(r => setTimeout(r, delayMs));

    } catch (applyErr) {
      console.error(`     ↳ ❌ Error applying: ${applyErr.message}`);
      job.status = 'failed';
      job.failureReason = applyErr.message;
      companyAts.saveAtsJobs(atsData);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`🏁 ATS Processing Finished: ${appliedCount} applied, ${skippedCount} skipped, ${processedCount} evaluated`);
  console.log('='.repeat(70) + '\n');
}

main().catch(err => {
  console.error('Fatal error in ATS Queue Processor:', err);
  process.exit(1);
});
