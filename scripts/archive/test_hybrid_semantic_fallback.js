const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExternalApplyEngine = require('../engine/externalApplyEngine');

const APPS_FILE = path.join(__dirname, '..', 'data', 'applications.json');
const originalAppsData = fs.readFileSync(APPS_FILE, 'utf8');

async function testHybridSemanticFallback() {
  console.log('================================================================');
  console.log('🌲 TESTING HYBRID SEMANTIC RESOLVER (a11y Tree Fallback)');
  console.log('================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const mockBridge = {
    humanDelay: async () => new Promise(r => setTimeout(r, 100)),
    page: page
  };
  const engine = new ExternalApplyEngine(mockBridge);

  // High-fidelity page with ZERO standard CSS classes or standard IDs:
  // Traditional DOM selectors like '.jobs-apply-button', 'input[name="first_name"]', 'button:has-text("Apply")' WILL FAIL!
  console.log('1. Constructing obfuscated page with non-standard div-soup & ARIA semantics...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Senior AI Architect - Obfuscated Portal</title></head>
      <body>
        <div id="root">
          <!-- Obfuscated Apply Button (div role="button" with aria-label) -->
          <div role="button" aria-label="Apply for this position" tabindex="0" id="cta-x1">
            <svg><path d="M..."></path></svg>
          </div>

          <!-- Obfuscated Form Container (hidden initially, shown after CTA click) -->
          <div id="portal-form" style="display: none;">
            <!-- File Dropzone -->
            <div data-automation-id="file-upload-drop-zone">
              <input type="file" name="doc" />
            </div>

            <!-- Obfuscated First Name with aria-label -->
            <div role="textbox" aria-label="Legal First Name" contenteditable="true" id="f-1"></div>
            <!-- Obfuscated Last Name with aria-label -->
            <div role="textbox" aria-label="Legal Last Name" contenteditable="true" id="f-2"></div>
            <!-- Obfuscated Email with aria-label -->
            <div role="textbox" aria-label="Email Address" contenteditable="true" id="f-3"></div>

            <!-- Certification checkbox -->
            <label><input type="checkbox" checked /> I certify under penalty of perjury that this is true.</label>

            <!-- Obfuscated Submit Button -->
            <div role="button" aria-label="Submit Application" tabindex="0" id="sub-x9">
              <span>Send Form</span>
            </div>
          </div>
        </div>

        <script>
          document.getElementById('cta-x1').addEventListener('click', () => {
            document.getElementById('cta-x1').style.display = 'none';
            document.getElementById('portal-form').style.display = 'block';
          });
        </script>
      </body>
    </html>
  `);

  console.log('2. Verifying standard DOM queries fail on this page...');
  const domApply = await page.$('.jobs-apply-button, button:has-text("Apply on company website"), button:has-text("Apply")');
  console.log(`   Standard DOM Apply button: ${domApply !== null ? 'Found' : 'NOT FOUND (Expected)'}`);

  console.log('\n3. Testing engine.findApplyButton() with Semantic Resolver fallback...');
  const resolvedApplyBtn = await engine.findApplyButton(page);
  console.log(`✓ Resolved Apply button via Accessibility Tree: ${resolvedApplyBtn !== null}`);

  if (resolvedApplyBtn) {
    console.log('   Clicking semantic Apply button...');
    await resolvedApplyBtn.click();
    await page.waitForTimeout(300);
  }

  console.log('\n4. Testing engine.areFormFieldsDirectlyOpen() with Semantic Resolver fallback...');
  const formOpen = await engine.areFormFieldsDirectlyOpen(page);
  console.log(`✓ Form detected as open via Accessibility Tree: ${formOpen}`);

  console.log('\n5. Executing Stage 3 & 4 with Semantic Resolver active...');
  const mockJob = {
    jobId: 'sem-test-1',
    company: 'SemanticCorp',
    title: 'Senior AI Architect',
    url: 'https://semanticcorp.jobs/apply'
  };

  const result = await engine.executeStage3And4(page, mockJob, (msg) => console.log('   [Engine]', msg), {
    dryRun: true,
    mode: 'review'
  });

  console.log('\n================================================================');
  console.log('📋 SEMANTIC RESOLVER TEST OUTCOME:');
  console.log('================================================================');
  console.log(`Status: ${result.status}`);
  console.log(`Code:   ${result.code}`);

  if (result.status === 'dry_run_complete' && result.code === 'DRY_RUN_STOPPED_BEFORE_SUBMIT') {
    console.log('\n🎉 TEST PASSED! The Accessibility Tree successfully resolved obfuscated elements where DOM failed!');
  } else {
    throw new Error('Test failed: Semantic resolver did not complete dry run.');
  }

  await browser.close();
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
}

testHybridSemanticFallback().catch(err => {
  console.error('Semantic test failed:', err);
  fs.writeFileSync(APPS_FILE, originalAppsData, 'utf8');
  process.exit(1);
});
