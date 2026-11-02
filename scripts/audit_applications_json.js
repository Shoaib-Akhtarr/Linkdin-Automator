const fs = require('fs');

const apps = JSON.parse(fs.readFileSync('data/applications.json', 'utf8')).applications || [];
console.log('Total applications count:', apps.length);
const recent = apps.slice(0, 10);
console.log('\nRecent 10 applications:');
for (const a of recent) {
  console.log(` - [${a.status}] ${a.title} @ ${a.company} (${a.appliedAt || a.lastAttempt || a.timestamp})`);
}

const testOrDryRun = apps.filter(a => 
  (a.company && (a.company.includes('Canonical') || a.company.includes('Spotify') || a.company.includes('Mock') || a.company.includes('DryRun') || a.company.includes('Captcha') || a.company.includes('Legal') || a.company.includes('Unverified') || a.company.includes('Validation'))) ||
  (a.title && a.title.includes('Ubuntu Core'))
);

console.log('\nMatching test/dryrun records found in applications.json:', testOrDryRun.length);
if (testOrDryRun.length > 0) {
  console.log(testOrDryRun);
} else {
  console.log('✓ Clean! Zero test/dry-run records in production database.');
}
