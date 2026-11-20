/**
 * Daily Summary & Health Monitor for AutoApply-AI
 * Run: node scripts/daily_summary.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS_FILE = path.join(ROOT, 'data', 'applications.json');
const ATS_FILE = path.join(ROOT, 'data', 'ats_jobs.json');
const HN_FILE = path.join(ROOT, 'data', 'hn_discovered_jobs.json');
const SETTINGS_FILE = path.join(ROOT, 'config', 'settings.json');

function loadJson(p, def = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return def;
}

console.log('='.repeat(65));
console.log('📊 AutoApply-AI — Daily Operations & Health Summary');
console.log('='.repeat(65));

// 1. Settings Status
const settings = loadJson(SETTINGS_FILE);
console.log('\n[⚙️  Current System Configuration]');
console.log(` • Mode:                  ${settings.execution?.mode || 'autonomous'}`);
console.log(` • Daily Limit:           ${settings.execution?.dailyApplicationLimit || 30} applications/day`);
console.log(` • Human Delay Pace:      ${settings.execution?.minDelayMs || 2000}ms – ${settings.execution?.maxDelayMs || 5000}ms`);
console.log(` • Match Threshold:       ${settings.intelligence?.minimumMatchScore || 70}%`);
console.log(` • Target Keywords:       ${(settings.search?.keywords || []).join(', ')}`);

// 2. Today's Applications
const appsData = loadJson(APPS_FILE);
const apps = appsData.applications || [];
const todayIso = new Date().toISOString().slice(0, 10);

const todayApps = apps.filter(a => {
  const d = a.appliedAt || a.timestamp || a.lastAttempt || '';
  return d.startsWith(todayIso);
});

const statusCounts = {};
for (const a of apps) {
  const s = a.status || 'unknown';
  statusCounts[s] = (statusCounts[s] || 0) + 1;
}

console.log('\n[📋 Lifetime Application Ledger]');
console.log(` • Total Recorded:        ${apps.length}`);
console.log(` • Total Applied:         ${statusCounts['applied'] || 0}`);
console.log(` • Needs Review / Check:  ${(statusCounts['needs_review'] || 0) + (statusCounts['UNVERIFIED_MANUAL_CHECK'] || 0)}`);
console.log(` • Failed:                ${statusCounts['failed'] || 0}`);
console.log(` • Skipped / Closed:      ${statusCounts['skipped'] || 0}`);

console.log(`\n[📅 Applications Today (${todayIso})]: ${todayApps.length}`);
if (todayApps.length > 0) {
  todayApps.slice(-8).reverse().forEach(a => {
    console.log(` • [${a.status}] ${a.title} @ ${a.company} (${a.platform})`);
  });
} else {
  console.log(' • No applications submitted yet today.');
}

// 3. ATS Queue
const atsData = loadJson(ATS_FILE);
const atsJobs = atsData.jobs || [];
const atsPending = atsJobs.filter(j => j.status === 'PENDING_APPROVAL');
const atsApplied = atsJobs.filter(j => j.status === 'applied');

console.log('\n[🏢 Direct Company ATS Pipeline (Ashby / Greenhouse / Lever)]');
console.log(` • Total Discovered:      ${atsJobs.length}`);
console.log(` • Pending Approval:      ${atsPending.length}`);
console.log(` • Applied via ATS:       ${atsApplied.length}`);
if (atsPending.length > 0) {
  console.log(' • Top 3 Pending Opportunities:');
  atsPending.slice(0, 3).forEach(j => {
    console.log(`   - ${j.title} @ ${j.company} (${j.platform.toUpperCase()}) -> ${j.url}`);
  });
}

// 4. HN Queue
const hnData = loadJson(HN_FILE);
const hnJobs = hnData.jobs || [];
const hnWithEmail = hnJobs.filter(j => j.contactEmail || (j.allEmails && j.allEmails.length > 0));

console.log('\n[💡 Hacker News "Who is Hiring?" Pipeline]');
console.log(` • Discovered HN Roles:   ${hnJobs.length}`);
console.log(` • With Direct Email:     ${hnWithEmail.length}`);

console.log('\n' + '='.repeat(65));
console.log('✓ System Ready. Launch START_DASHBOARD.bat to approve & run.');
console.log('='.repeat(65) + '\n');
