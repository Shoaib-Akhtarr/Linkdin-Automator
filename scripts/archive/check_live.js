async function check() {
  try {
    const res = await fetch('http://localhost:3000/api/status');
    const data = await res.json();
    console.log(`[Status] State: ${data.state} | Current Job: ${data.currentJob ? data.currentJob.title + ' @ ' + data.currentJob.company : 'None'}`);
    console.log(`[Stats] Today: ${data.stats?.todayApplied} | Total Applied: ${data.stats?.totalApplied} | Skipped: ${data.stats?.skipped} | Failed: ${data.stats?.failed}`);
    console.log('\n--- Recent Logs ---');
    (data.logs || []).slice(-10).forEach(l => {
      console.log(`[${l.timestamp}] [${l.type}] ${l.message}`);
    });
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}
check();
