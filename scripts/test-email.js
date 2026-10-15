const emailNotifier = require('../engine/emailNotifier');

async function test() {
  console.log('Testing email dispatch with credentials...');
  const res = await emailNotifier.sendReport({
    cycleTime: new Date().toLocaleString(),
    batchApplied: 1,
    batchSkipped: 0,
    totalAppliedToday: 49,
    dailyLimit: 80,
    appliedJobs: [
      {
        title: 'Senior AI Engineer / Agentic AI Architect',
        company: 'CodeNinja Inc.',
        location: 'Lahore (Hybrid)',
        cvUsed: 'shoaib_akhtar_cv7_ai_engineer.pdf'
      }
    ]
  });
  console.log('Send report result:', res);
}

test();
