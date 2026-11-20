const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');

(async () => {
  console.log('--- Testing External Apply Engine Architecture ---');
  const mockBridge = {
    humanDelay: async () => {},
    getPage: async () => null
  };

  const engine = new ExternalApplyEngine(mockBridge);

  // Test Platform Detection
  const ghPlatform = await engine.detectPlatform(null, 'https://boards.greenhouse.io/anthropic/jobs/123456');
  console.log('✓ Detected Greenhouse URL:', ghPlatform);

  const leverPlatform = await engine.detectPlatform(null, 'https://jobs.lever.co/scaleai/abcdef123');
  console.log('✓ Detected Lever URL:', leverPlatform);

  const ashbyPlatform = await engine.detectPlatform(null, 'https://jobs.ashbyhq.com/openai/987654');
  console.log('✓ Detected Ashby URL:', ashbyPlatform);

  const workdayPlatform = await engine.detectPlatform(null, 'https://company.myworkdayjobs.com/careers/job/123');
  console.log('✓ Detected Workday URL:', workdayPlatform);

  if (ghPlatform === 'greenhouse' && leverPlatform === 'lever' && ashbyPlatform === 'ashby' && workdayPlatform === 'workday') {
    console.log('\n SUCCESS: External Apply Engine platform signatures verified!');
    process.exit(0);
  } else {
    console.error(' Platform detection failed.');
    process.exit(1);
  }
})();
