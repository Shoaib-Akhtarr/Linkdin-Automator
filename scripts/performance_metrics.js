#!/usr/bin/env node
/**
 * AutoApply-AI — Performance Metrics & Weekly KPI Analyzer
 * 
 * Computes deep funnel analytics, tailoring ratio, platform conversion,
 * response rates, and daily application velocity.
 * 
 * Usage:
 *   node scripts/performance_metrics.js [--export]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS_FILE = path.join(ROOT, 'data', 'applications.json');
const ATS_FILE = path.join(ROOT, 'data', 'ats_jobs.json');
const HN_FILE = path.join(ROOT, 'data', 'hn_discovered_jobs.json');
const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json');
const REPORT_MD = path.join(ROOT, 'data', 'weekly_performance_report.md');
const REPORT_JSON = path.join(ROOT, 'data', 'weekly_performance_report.json');

function loadJson(p, def = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return def;
}

function parseDate(record) {
  const d = record.appliedAt || record.lastAttempt || record.timestamp || record.detectedAt;
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function main() {
  const args = process.argv.slice(2);
  const shouldExport = args.includes('--export') || true;

  console.log('='.repeat(72));
  console.log('📈 AutoApply-AI — Comprehensive Performance Metrics & KPI Audit');
  console.log('='.repeat(72));

  const settings = loadJson(SETTINGS_FILE);
  const appsData = loadJson(APPS_FILE);
  const apps = appsData.applications || [];

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  // 1. Core Status Counts
  const statusCounts = {};
  for (const a of apps) {
    const s = a.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const totalRecorded = apps.length;
  const totalApplied = statusCounts['applied'] || 0;
  const totalFailed = statusCounts['failed'] || 0;
  const totalSkipped = statusCounts['skipped'] || 0;
  const totalCheck = (statusCounts['UNVERIFIED_MANUAL_CHECK'] || 0) + (statusCounts['needs_review'] || 0);
  const totalInterviews = (statusCounts['INTERVIEW_REQUEST'] || 0) + (statusCounts['interview'] || 0);
  const totalAcknowledged = statusCounts['ACKNOWLEDGED'] || 0;

  // 2. Time Windows (Today, 7 days, 14 days, 30 days)
  const appliedApps = apps.filter(a => a.status === 'applied');
  
  const todayApps = appliedApps.filter(a => {
    const d = parseDate(a);
    return d && (now - d) < dayMs;
  });

  const last7dApps = appliedApps.filter(a => {
    const d = parseDate(a);
    return d && (now - d) < (7 * dayMs);
  });

  const last14dApps = appliedApps.filter(a => {
    const d = parseDate(a);
    return d && (now - d) < (14 * dayMs);
  });

  const last30dApps = appliedApps.filter(a => {
    const d = parseDate(a);
    return d && (now - d) < (30 * dayMs);
  });

  // 3. CV Tailoring Metrics
  let tailoredCount = 0;
  let defaultCount = 0;
  for (const a of appliedApps) {
    const cv = a.cvUsed || '';
    if (cv.toLowerCase().includes('.pdf') && !cv.toLowerCase().includes('default')) {
      tailoredCount++;
    } else {
      defaultCount++;
    }
  }
  const tailoringRatio = appliedApps.length > 0 
    ? Math.round((tailoredCount / appliedApps.length) * 100) 
    : 0;

  // 4. Platform Performance Breakdown
  const platformStats = {};
  for (const a of apps) {
    const p = (a.platform || 'other').toLowerCase();
    if (!platformStats[p]) {
      platformStats[p] = { attempts: 0, applied: 0, failed: 0, skipped: 0 };
    }
    platformStats[p].attempts++;
    if (a.status === 'applied') platformStats[p].applied++;
    else if (a.status === 'failed') platformStats[p].failed++;
    else if (a.status === 'skipped') platformStats[p].skipped++;
  }

  // 5. Failure Reason Clustering
  const failureReasons = {};
  for (const a of apps.filter(x => x.status === 'failed' || x.status === 'skipped')) {
    const rawReason = (a.notes || a.reason || a.failureReason || 'Unspecified').trim();
    // Normalize common patterns
    let category = 'Other Failure';
    if (/sign-in|login|password|auth/i.test(rawReason)) category = 'Authentication / Login Gate Required';
    else if (/no apply button|cannot find apply/i.test(rawReason)) category = 'Apply Button Selector Not Found (Expired/Stale)';
    else if (/stack size|recursion/i.test(rawReason)) category = 'DOM Form Traversal Loop (Fixed)';
    else if (/required field|missing entry/i.test(rawReason)) category = 'Unanswered Custom Portal Questions';
    else if (/quota|closed|no longer accepting/i.test(rawReason)) category = 'Position Closed / Quota Filled';
    else if (/clearance|citizenship/i.test(rawReason)) category = 'Citizenship / Security Clearance Gated';
    else if (/pre-filter|threshold|mismatch/i.test(rawReason)) category = 'Score or Seniority Filter Triggered';

    failureReasons[category] = (failureReasons[category] || 0) + 1;
  }

  // 6. Response & Interview Conversion
  const verifiedResponses = totalAcknowledged + totalInterviews;
  const responseRate = appliedApps.length > 0 
    ? ((verifiedResponses / appliedApps.length) * 100).toFixed(1) 
    : '0.0';

  // 7. Calculate System Health Score (0-100)
  let healthScore = 50;
  if (tailoringRatio >= 70) healthScore += 15;
  else if (tailoringRatio >= 40) healthScore += 8;

  if (settings.execution?.dailyApplicationLimit <= 40) healthScore += 10;
  if (settings.intelligence?.minimumMatchScore >= 70) healthScore += 15;
  if (settings.intelligence?.filterCitizenshipRestricted) healthScore += 5;
  if (totalApplied > 100) healthScore += 5;
  healthScore = Math.min(100, healthScore);

  // Print Formatted Report
  console.log('\n[1. SYSTEM VELOCITY & VOLUME]');
  console.log(` • Lifetime Applications Recorded:   ${totalRecorded}`);
  console.log(` • Successful Applications (Applied): ${totalApplied} (${Math.round((totalApplied/totalRecorded)*100)}% overall conversion)`);
  console.log(` • Applications Submitted Today:     ${todayApps.length} / ${settings.execution?.dailyApplicationLimit || 30} limit`);
  console.log(` • Velocity (Past 7 Days):            ${last7dApps.length} applications`);
  console.log(` • Velocity (Past 14 Days):           ${last14dApps.length} applications`);
  console.log(` • Velocity (Past 30 Days):           ${last30dApps.length} applications`);

  console.log('\n[2. RESUME TAILORING QUALITY]');
  console.log(` • Dynamically Tailored CVs:          ${tailoredCount} (${tailoringRatio}%)`);
  console.log(` • Generic ATS Base Resumes:          ${defaultCount} (${100 - tailoringRatio}%)`);
  console.log(` • Target Benchmark:                  >80% Tailored [${tailoringRatio >= 80 ? '✅ EXCELLING' : '⚠️ PROGRESSING'}]`);

  console.log('\n[3. PLATFORM SUCCESS BREAKDOWN]');
  console.log(' Platform'.padEnd(18) + 'Attempts'.padEnd(12) + 'Applied'.padEnd(10) + 'Success Rate');
  console.log('-'.repeat(52));
  for (const [p, s] of Object.entries(platformStats)) {
    const rate = s.attempts > 0 ? Math.round((s.applied / s.attempts) * 100) : 0;
    console.log(` ${p.padEnd(17)}${String(s.attempts).padEnd(12)}${String(s.applied).padEnd(10)}${rate}%`);
  }

  console.log('\n[4. FUNNEL & RESPONSE CONVERSION]');
  console.log(` • Total Applied:                     ${totalApplied}`);
  console.log(` • Acknowledged & Under Review:       ${totalAcknowledged}`);
  console.log(` • Interview Requests:                ${totalInterviews}`);
  console.log(` • Recorded Response Rate:            ${responseRate}%`);

  console.log('\n[5. TOP SYSTEM OBSTACLES]');
  const sortedFailures = Object.entries(failureReasons).sort((a,b) => b[1] - a[1]);
  for (const [reason, count] of sortedFailures.slice(0, 5)) {
    console.log(` • ${count}x: ${reason}`);
  }

  console.log('\n[6. OVERALL PIPELINE HEALTH SCORE]');
  console.log(` • Health Score:                      ${healthScore}/100 [${healthScore >= 80 ? '🟢 HEALTHY' : '🟡 TUNING NEEDED'}]`);

  // Export JSON & Markdown reports
  const reportData = {
    generatedAt: now.toISOString(),
    healthScore,
    totals: { totalRecorded, totalApplied, totalFailed, totalSkipped, totalCheck, totalInterviews, totalAcknowledged },
    velocity: { today: todayApps.length, last7d: last7dApps.length, last14d: last14dApps.length, last30d: last30dApps.length },
    tailoring: { tailoredCount, defaultCount, tailoringRatio },
    platformStats,
    failureReasons,
    responseRate
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportData, null, 2), 'utf8');

  const mdReport = `# 📊 AutoApply-AI — Weekly Performance Audit
**Generated:** ${now.toLocaleString()}  
**Overall System Health Score:** **${healthScore}/100**

---

## 🚀 Application Velocity
| Period | Applications Applied | Status |
| :--- | :--- | :--- |
| **Today** | **${todayApps.length}** / ${settings.execution?.dailyApplicationLimit || 30} | ${todayApps.length <= 30 ? '✅ Within Safe Limits' : '⚠️ Limit Exceeded'} |
| **Past 7 Days** | **${last7dApps.length}** | Active |
| **Past 14 Days** | **${last14dApps.length}** | Active |
| **Past 30 Days** | **${last30dApps.length}** | Active |
| **Lifetime Applied** | **${totalApplied}** | Total |

---

## 🎯 Quality & CV Tailoring
- **Tailored CV Ratio:** **${tailoringRatio}%** (${tailoredCount} tailored vs ${defaultCount} default)
- **Target:** >80% (${tailoringRatio >= 80 ? '✅ Target Met' : '⚠️ In Progress'})

---

## 🌐 Platform Conversion Matrix
| Platform | Attempts | Applied | Success Rate |
| :--- | :--- | :--- | :--- |
${Object.entries(platformStats).map(([p, s]) => `| **${p}** | ${s.attempts} | ${s.applied} | **${s.attempts > 0 ? Math.round((s.applied / s.attempts) * 100) : 0}%** |`).join('\n')}

---

## 🔍 Top Application Obstacles
${sortedFailures.slice(0, 5).map(([r, c]) => `- **${c} occurrences:** ${r}`).join('\n')}

---
*AutoApply-AI Performance Engine*
`;

  fs.writeFileSync(REPORT_MD, mdReport, 'utf8');
  console.log(`\n[✓] Exported reports:`);
  console.log(`    - Markdown: data/weekly_performance_report.md`);
  console.log(`    - JSON:     data/weekly_performance_report.json`);
  console.log('='.repeat(72) + '\n');
}

main();
