const fs = require('fs');
const triAi = require('../engine/triAiEvaluator');

const evalPath = 'data/tri_ai_evaluations.json';
const atsJobsPath = 'data/ats_jobs.json';

const evals = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
const jobs = JSON.parse(fs.readFileSync(atsJobsPath, 'utf8')).jobs || [];
const jobsMap = new Map();
jobs.forEach(j => {
  if (j.jobId) jobsMap.set(j.jobId, j);
});

let updatedCount = 0;
for (const [jobId, evalData] of Object.entries(evals)) {
  const job = jobsMap.get(jobId);
  if (job) {
    evalData.beautifiedJd = triAi.beautifyJd(job);
    updatedCount++;
  }
}

fs.writeFileSync(evalPath, JSON.stringify(evals, null, 2), 'utf8');
console.log(`[✓] Successfully cleaned and refreshed beautified JDs for ${updatedCount} evaluation(s)!`);

// Verify Affirm
const affirmKey = Object.keys(evals).find(k => k.includes('affirm'));
if (affirmKey) {
  console.log('\n--- VERIFY AFFIRM BEAUTIFIED JD ---');
  console.log('Overview:', evals[affirmKey].beautifiedJd.overview.slice(0, 150));
  console.log('Bullets count:', evals[affirmKey].beautifiedJd.bullets.length);
  console.log('Sample bullet:', evals[affirmKey].beautifiedJd.bullets[0]);
  console.log('Skills detected:', evals[affirmKey].beautifiedJd.skills);
}
