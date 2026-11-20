const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');
const vaultManager = require('../engine/vaultManager');
const tracker = require('../engine/tracker');

const APPS_FILE = path.join(__dirname, '..', 'data', 'applications.json');
const originalAppsData = fs.readFileSync(APPS_FILE, 'utf8');

async function testWorkdayThrowawayDryRun() {
  console.log('================================================================');
  console.log('🏢 TESTING WORKDAY FULL STAGE 2 AUTH & WIZARD IN --dry-run MODE');
  console.log('================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  const mockBridge = {
    humanDelay: async (min, max) => new Promise(r => setTimeout(r, 100)),
    page: page
  };
  const engine = new ExternalApplyEngine(mockBridge);

  let submitClicked = false;

  // Set up a full high-fidelity Workday application flow with exact data-automation-ids
  console.log('1. Constructing authentic Workday DOM with official data-automation-id selectors...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Software Development Engineer - Workday Careers</title>
        <style>
          .hidden { display: none !important; }
          .visible { display: block !important; }
        </style>
      </head>
      <body>
        <!-- Workday OneTrust Cookie Banner -->
        <div id="onetrust-consent-sdk">
          <button id="onetrust-accept-btn-handler">Accept All Cookies</button>
        </div>

        <!-- Job Detail Page with Adventure Button -->
        <div id="job-detail-view" class="visible">
          <h1>Software Development Engineer (Workday Enterprise)</h1>
          <button data-automation-id="adventureButton">Apply</button>
          
          <div id="apply-options" class="hidden">
            <a data-automation-id="autofillWithResume" href="#auth">Autofill with Resume</a>
            <a data-automation-id="applyManually" href="#auth">Apply Manually</a>
          </div>
        </div>

        <!-- Stage 2 Workday Auth Modal -->
        <div id="auth-modal" class="hidden">
          <h2>Sign In / Create Account</h2>
          <div id="signin-tab">
            <input data-automation-id="email" type="email" placeholder="Email Address" />
            <input data-automation-id="password" type="password" placeholder="Password" />
            <button data-automation-id="signInSubmitButton" type="button">Sign In</button>
            <a data-automation-id="createAccountLink" href="#create">Create Account</a>
          </div>

          <div id="create-tab" class="hidden">
            <input data-automation-id="email" type="email" placeholder="Email Address" />
            <input data-automation-id="password" type="password" placeholder="Password" />
            <input data-automation-id="verifyPassword" type="password" placeholder="Verify Password" />
            <label><input data-automation-id="createAccountCheckbox" type="checkbox" /> I agree to Terms & Privacy Policy</label>
            <button data-automation-id="createAccountSubmitButton" type="button">Create Account</button>
          </div>
        </div>

        <!-- Stage 3 Workday Multi-Page Wizard -->
        <div id="wizard-container" class="hidden">
          <!-- Step 1: Resume Upload -->
          <div id="step-1" class="wizard-step visible">
            <h3>Quick Apply: Resume Upload</h3>
            <div data-automation-id="file-upload-drop-zone">
              <input type="file" name="resume" />
            </div>
            <button data-automation-id="bottom-navigation-next-button" type="button">Save and Continue</button>
          </div>

          <!-- Step 2: My Information -->
          <div id="step-2" class="wizard-step hidden">
            <h3>My Information</h3>
            <input data-automation-id="legalNameSection_firstName" type="text" />
            <input data-automation-id="legalNameSection_lastName" type="text" />
            <input data-automation-id="phone-number" type="tel" />
            <input data-automation-id="addressSection_addressLine1" type="text" />
            <input data-automation-id="addressSection_city" type="text" />
            <input data-automation-id="addressSection_postalCode" type="text" />
            <button data-automation-id="bottom-navigation-next-button" type="button">Save and Continue</button>
          </div>

          <!-- Step 3: Voluntary Disclosures & Final Review -->
          <div id="step-3" class="wizard-step hidden">
            <h3>Review & Submit</h3>
            <label><input type="checkbox" checked /> I certify that the information provided is accurate under penalty of perjury.</label>
            <button data-automation-id="bottom-navigation-submit-button" id="final-submit-btn" type="button">Submit Application</button>
          </div>
        </div>

        <script>
          // Realistic Workday state machine simulation
          const advBtn = document.querySelector('[data-automation-id="adventureButton"]');
          const optionsDiv = document.getElementById('apply-options');
          const autofillLink = document.querySelector('[data-automation-id="autofillWithResume"]');
          const authModal = document.getElementById('auth-modal');
          const signinTab = document.getElementById('signin-tab');
          const createTab = document.getElementById('create-tab');
          const createLink = document.querySelector('[data-automation-id="createAccountLink"]');
          const createSubmit = document.querySelector('[data-automation-id="createAccountSubmitButton"]');
          const wizard = document.getElementById('wizard-container');

          advBtn.addEventListener('click', () => {
            optionsDiv.className = 'visible';
          });

          autofillLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('job-detail-view').className = 'hidden';
            authModal.className = 'visible';
          });

          createLink.addEventListener('click', (e) => {
            e.preventDefault();
            signinTab.className = 'hidden';
            createTab.className = 'visible';
          });

          createSubmit.addEventListener('click', () => {
            // Registration success -> Lands on Wizard Step 1
            authModal.className = 'hidden';
            wizard.className = 'visible';
          });

          // Wizard step transitions
          document.querySelectorAll('[data-automation-id="bottom-navigation-next-button"]').forEach((btn, index) => {
            btn.addEventListener('click', () => {
              const fromStep = index + 1;
              const toStep = index + 2;
              const elFrom = document.getElementById('step-' + fromStep);
              const elTo = document.getElementById('step-' + toStep);
              if (elFrom) elFrom.className = 'wizard-step hidden';
              if (elTo) elTo.className = 'wizard-step visible';
            });
          });

          document.getElementById('final-submit-btn').addEventListener('click', () => {
            window.__workdaySubmitDispatched = true;
          });
        </script>
      </body>
    </html>
  `);

  const workdayJob = {
    jobId: 'workday-live-test-1',
    company: 'Workday Enterprise',
    title: 'Software Development Engineer',
    url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/Software-Development-Engineer_JR-0109889'
  };

  try {
    console.log('2. Executing Stage 1, Stage 2 (Throwaway 2PC Registration) & Stage 3 Wizard...');
    
    // Auto-dismiss cookie banner
    await engine.dismissCookieOverlays(page);
    console.log('✓ Dismissed OneTrust cookie banner on Workday.');

    // Click adventure button and autofill option
    const advBtn = await page.$('[data-automation-id="adventureButton"]');
    await advBtn.click();
    await page.waitForTimeout(300);
    const autofill = await page.$('[data-automation-id="autofillWithResume"]');
    await autofill.click();
    await page.waitForTimeout(300);
    console.log('✓ Workday "Autofill with Resume" clicked. Auth gate active.');

    // Execute Stage 2 (Will detect password form, create throwaway credentials in vault, and submit create account)
    const authResult = await engine.executeStage2Auth(page, workdayJob, (msg) => console.log('   [Auth]', msg), {
      dryRun: true,
      mode: 'review'
    });
    console.log(`✓ Stage 2 completed with status: "${authResult.status}"`);

    // Verify throwaway credentials were saved to vault in 2PC
    const savedCreds = vaultManager.getCredentials(workdayJob.url);
    console.log(`✓ Vault credentials for Workday tenant "${savedCreds.tenant}":`);
    console.log(`   Email:     ${savedCreds.email}`);
    console.log(`   Status:    ${savedCreds.status}`);
    console.log(`   Password:  ${savedCreds.password.slice(0, 4)}••••••••`);

    // Execute Stage 3 and 4 in --dry-run mode
    console.log('\n3. Executing Workday Multi-Page Wizard Engine in --dry-run mode...');
    const result = await engine.executeStage3And4(page, workdayJob, (msg) => console.log('   [Wizard]', msg), {
      dryRun: true,
      mode: 'review'
    });

    submitClicked = await page.evaluate(() => window.__workdaySubmitDispatched === true);

    console.log('\n================================================================');
    console.log('📋 WORKDAY TEST RESULTS:');
    console.log('================================================================');
    console.log(`Outcome Status:        ${result.status}`);
    console.log(`Outcome Code:          ${result.code}`);
    console.log(`Dry-run Intercept:     ${result.status === 'dry_run_complete' ? 'YES (Cleanly Intercepted)' : 'NO'}`);
    console.log(`Final Submit Clicked:  ${submitClicked ? 'YES (UNSAFE)' : 'NO (STRICTLY BLOCKED)'}`);

    // Verify applications.json audit
    const currentApps = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8')).applications || [];
    const leakedRecords = currentApps.filter(a => a.jobId === 'workday-live-test-1');
    console.log(`applications.json count: ${currentApps.length} (Original: 1773)`);
    console.log(`Leaked records in DB:    ${leakedRecords.length} (Strictly 0 expected)`);

    if (result.status === 'dry_run_complete' && !submitClicked && leakedRecords.length === 0) {
      console.log('\n🎉 ALL WORKDAY TESTS PASSED! STAGE 2 + WIZARD + DRY-RUN VERIFIED.');
    } else {
      throw new Error('Workday test failed assertion!');
    }

  } finally {
    await browser.close();
    // Clean up test credentials from vault
    const rawVault = vaultManager.loadRawVault();
    delete rawVault[vaultManager.getTenantKey(workdayJob.url)];
    vaultManager.saveRawVault(rawVault);
    // Ensure applications.json remains 100% untouched
    fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
    console.log('✓ Cleaned up test vault tenant and verified applications.json integrity.');
  }
}

testWorkdayThrowawayDryRun().catch(err => {
  console.error('Workday test failed:', err);
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
  process.exit(1);
});
