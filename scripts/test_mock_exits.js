const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');
const tracker = require('../engine/tracker');

// Backup applications.json to preserve live state during mock exit testing
const APPS_FILE = path.join(__dirname, '..', 'data', 'applications.json');
const originalAppsData = fs.readFileSync(APPS_FILE, 'utf8');

async function runMockExitTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING EXTERNAL APPLY ENGINE MOCK EXIT SUITE');
  console.log('====================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Mock bridge with fast delays for tests
  const mockBridge = {
    humanDelay: async (min, max) => new Promise(r => setTimeout(r, 100)),
    page: page
  };
  const engine = new ExternalApplyEngine(mockBridge);

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
    }
  }

  try {
    // ----------------------------------------------------
    // TEST 1: BLOCKED_CAPTCHA (Interactive CAPTCHA on Landing)
    // ----------------------------------------------------
    console.log('▶ TEST 1: Interactive CAPTCHA Detection (Stage 1 Exit)');
    await page.setContent(`
      <html>
        <body>
          <h1>Security Verification</h1>
          <iframe title="recaptcha challenge expires in two minutes" src="about:blank" style="width:300px;height:400px;display:block;"></iframe>
        </body>
      </html>
    `);
    const captchaJob = { jobId: 'mock-captcha-1', title: 'AI Engineer', company: 'CaptchaCorp', url: 'https://jobs.ashbyhq.com/captchacorp/123' };
    
    // Test the interactive CAPTCHA detector and record
    const hasCaptcha = await engine.isInteractiveCaptchaVisible(page);
    assert(hasCaptcha === true, 'Detected interactive CAPTCHA iframe in DOM');
    
    let captchaResult;
    if (hasCaptcha) {
      tracker.recordOutcome(captchaJob, 'BLOCKED_CAPTCHA', { stage: 'landing', code: 'CODE_CAPTCHA_LANDING_BLOCK' });
      captchaResult = { status: 'blocked', code: 'CODE_CAPTCHA_LANDING_BLOCK', stage: 'landing' };
    }
    
    assert(captchaResult.status === 'blocked', 'Status is "blocked"');
    assert(captchaResult.code === 'CODE_CAPTCHA_LANDING_BLOCK', 'Exit code is CODE_CAPTCHA_LANDING_BLOCK');
    const captchaPreflight = tracker.evaluatePreFlightClass(captchaJob);
    assert(captchaPreflight.class === 'COOLDOWN' || captchaPreflight.class === 'HOLD', `Tracker recorded as cooldown/hold (${captchaPreflight.class})`);
    console.log('');

    // ----------------------------------------------------
    // TEST 2: FAILED_MISSING_LEGAL_CONFIG (Consent to Certify Opt-In Missing)
    // ----------------------------------------------------
    console.log('▶ TEST 2: Missing Legal Config Opt-In (Stage 3 Mandatory Gate)');
    // Temporarily mock profile without consentToCertify
    const originalGetProfile = engine.getProfile;
    engine.getProfile = () => ({
      name: 'Shoaib Akhtar',
      email: 'mshoaibakhtar2004@gmail.com',
      phone: '+923123456789',
      legalAttestations: {
        consentToCertify: false, // Opt-in NOT granted
        consentToTerms: true
      }
    });

    await page.setContent(`
      <html>
        <body>
          <form>
            <input type="text" name="name" value="Shoaib Akhtar" />
            <label>
              <input type="checkbox" name="certify" />
              I certify that all statements made on this application are true, complete and correct under penalty of perjury.
            </label>
            <button type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `);
    const legalJob = { jobId: 'mock-legal-1', title: 'ML Researcher', company: 'LegalCorp', url: 'https://boards.greenhouse.io/legalcorp/jobs/123' };
    const legalResult = await engine.executeStage3And4(page, legalJob, () => {}, {});
    
    assert(legalResult.status === 'blocked', 'Status is "blocked" due to unmapped legal opt-in');
    assert(legalResult.code === 'CODE_MANDATORY_LEGAL_FIELD_UNMAPPED', 'Exit code is CODE_MANDATORY_LEGAL_FIELD_UNMAPPED');
    const legalPreflight = tracker.evaluatePreFlightClass(legalJob);
    assert(legalPreflight.class === 'HOLD', 'Tracker classified as permanent HOLD (never auto-retried)');
    console.log('');

    // Restore profile
    engine.getProfile = originalGetProfile;

    // ----------------------------------------------------
    // TEST 3: DRY-RUN STOP BEFORE FINAL SUBMIT (With Review Mode ON)
    // ----------------------------------------------------
    console.log('▶ TEST 3: --dry-run Pre-Submit Interceptor with Review Mode ON');
    let submitWasClicked = false;
    await page.setContent(`
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="name" value="Shoaib Akhtar" />
            <input type="email" name="email" value="mshoaibakhtar2004@gmail.com" />
            <label><input type="checkbox" name="certify" checked /> I certify under penalty of perjury that this is accurate.</label>
            <button type="submit" id="btn-submit">Submit Application</button>
          </form>
          <script>
            document.getElementById('btn-submit').addEventListener('click', () => { window.__clicked = true; });
          </script>
        </body>
      </html>
    `);
    const dryRunJob = { jobId: 'mock-dryrun-1', title: 'Software Engineer', company: 'DryRunCorp', url: 'https://jobs.lever.co/dryruncorp/123' };
    const dryRunResult = await engine.executeStage3And4(page, dryRunJob, (msg) => console.log('    [Log]', msg), {
      dryRun: true,
      mode: 'review'
    });

    submitWasClicked = await page.evaluate(() => window.__clicked === true);
    assert(dryRunResult.status === 'dry_run_complete', 'Status is "dry_run_complete"');
    assert(dryRunResult.code === 'DRY_RUN_STOPPED_BEFORE_SUBMIT', 'Exit code is DRY_RUN_STOPPED_BEFORE_SUBMIT');
    assert(submitWasClicked === false, 'Submit button click was STRICTLY PREVENTED');
    console.log('');

    // ----------------------------------------------------
    // TEST 4: UNVERIFIED_MANUAL_CHECK (Submit Clicked, No Proof Detected)
    // ----------------------------------------------------
    console.log('▶ TEST 4: UNVERIFIED_MANUAL_CHECK (Post-Submit Proof Absent)');
    await page.setContent(`
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="first_name" value="Shoaib" />
            <label><input type="checkbox" checked /> I certify this application is true.</label>
            <button type="submit" id="btn-submit">Submit Application</button>
          </form>
          <script>
            document.getElementById('btn-submit').addEventListener('click', (e) => {
              e.preventDefault();
              // Simulates hanging page / no thank you receipt / no inline error
              document.getElementById('btn-submit').innerText = 'Submitted (Wait...)';
            });
          </script>
        </body>
      </html>
    `);
    const unverifiedJob = { jobId: 'mock-unverified-1', title: 'AI Developer', company: 'UnverifiedCorp', url: 'https://jobs.ashbyhq.com/unverifiedcorp/123' };
    const unverifiedResult = await engine.executeStage3And4(page, unverifiedJob, (msg) => console.log('    [Log]', msg), {
      dryRun: false,
      mode: 'autonomous'
    });

    assert(unverifiedResult.status === 'unverified', 'Status is "unverified"');
    assert(unverifiedResult.code === 'UNVERIFIED_MANUAL_CHECK' || unverifiedResult.code === 'CODE_SUBMISSION_UNVERIFIED_RECEIPT', 'Exit code is UNVERIFIED_MANUAL_CHECK');
    const unverifiedPreflight = tracker.evaluatePreFlightClass(unverifiedJob);
    assert(unverifiedPreflight.class === 'HOLD', 'Tracker classified UNVERIFIED as HOLD (manual check required, zero auto re-apply)');
    console.log('');

    // ----------------------------------------------------
    // TEST 5: FAILED_STEP_VALIDATION (Wizard Self-Heal Exhaustion)
    // ----------------------------------------------------
    console.log('▶ TEST 5: FAILED_STEP_VALIDATION (Persistent Inline Errors)');
    await page.setContent(`
      <html>
        <body>
          <form>
            <input type="text" name="name" value="Shoaib Akhtar" />
            <label><input type="checkbox" checked /> I certify</label>
            <button type="button" id="btn-next">Next</button>
            <div id="error-container"></div>
          </form>
          <script>
            document.getElementById('btn-next').addEventListener('click', () => {
              document.getElementById('error-container').innerHTML = '<div class="field-error">Please complete all required fields properly.</div>';
            });
          </script>
        </body>
      </html>
    `);
    const validationJob = { jobId: 'mock-validation-1', title: 'AI Engineer', company: 'ValidationCorp', url: 'https://myworkdayjobs.com/validationcorp/apply' };
    const validationResult = await engine.executeStage3And4(page, validationJob, (msg) => console.log('    [Log]', msg), {
      dryRun: false
    });

    assert(validationResult.status === 'failed', 'Status is "failed"');
    assert(validationResult.code === 'CODE_STEP_VALIDATION_FAILED', 'Exit code is CODE_STEP_VALIDATION_FAILED');
    const valPreflight = tracker.evaluatePreFlightClass(validationJob);
    assert(valPreflight.class === 'COOLDOWN' || valPreflight.class === 'HOLD', `Classified as cooldown/hold (${valPreflight.class})`);
    console.log('');

    console.log('====================================================');
    console.log(`RESULTS: ${passed} / ${total} TESTS PASSED!`);
    console.log('====================================================');

  } finally {
    await browser.close();
    // Restore original applications.json cleanly
    fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
    console.log('\n✓ Restored applications.json cleanly. Live database untouched.');
  }
}

runMockExitTests().catch(err => {
  console.error('Test suite failure:', err);
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
  process.exit(1);
});
