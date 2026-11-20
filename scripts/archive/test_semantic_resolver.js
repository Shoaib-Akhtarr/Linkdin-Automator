const { chromium } = require('playwright');

async function testSemanticResolution() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  // Create a page with ZERO traditional standard classes/IDs (pure custom tags, div soup, SVG icons)
  // Standard CSS selectors like input[name="first_name"] or button.btn-apply will FAIL on this page!
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body>
        <div class="x99-layout-container">
          <!-- Obfuscated custom button with SVG icon, no text node inside -->
          <div role="button" aria-label="Apply on company website" tabindex="0" class="custom-cta-xyz">
            <svg viewBox="0 0 24 24"><path d="M..."></path></svg>
          </div>

          <!-- Custom styled input without standard name or id, labeled via aria-labelledby -->
          <div id="lbl-usr-given">Legal First Name</div>
          <div role="textbox" aria-labelledby="lbl-usr-given" contenteditable="true" class="custom-input-box"></div>

          <!-- Custom checkbox with aria-checked -->
          <div role="checkbox" aria-checked="false" aria-label="I certify under penalty of perjury" tabindex="0" class="custom-chk"></div>

          <!-- Custom submit button -->
          <div role="button" aria-label="Submit Application" tabindex="0" class="custom-submit-cta">
            <span>Send</span>
          </div>
        </div>
      </body>
    </html>
  `);

  console.log('--- 1. Testing Standard DOM Lookups (Expected to FAIL) ---');
  const domApplyBtn = await page.$('.jobs-apply-button, button:has-text("Apply")');
  console.log('DOM Apply Button found:', domApplyBtn !== null); // false!

  const domNameInput = await page.$('input[name*="first_name" i], input[id*="first_name" i]');
  console.log('DOM First Name Input found:', domNameInput !== null); // false!

  console.log('\n--- 2. Testing Accessibility Tree Semantic Snapshot ---');
  const ariaYaml = await page.ariaSnapshot();
  console.log('Official Accessibility YAML Snapshot:\n' + ariaYaml);

  console.log('\n--- 3. Resolving Live Handles via Semantic Resolver ---');
  // 1. Resolve Apply Button via semantic role & accessible name
  const semApplyLocator = page.getByRole('button', { name: /apply/i });
  const semApply = await semApplyLocator.elementHandle();
  console.log('✓ Semantic Apply Button resolved:', semApply !== null);
  if (semApply) {
    console.log('   Visible:', await semApply.isVisible());
    console.log('   Aria Label:', await semApply.getAttribute('aria-label'));
  }

  // 2. Resolve Legal First Name
  const semNameLocator = page.getByRole('textbox', { name: /first name/i });
  const semName = await semNameLocator.elementHandle();
  console.log('✓ Semantic First Name resolved:', semName !== null);

  // 3. Resolve Certification Checkbox
  const semCertLocator = page.getByRole('checkbox', { name: /certify/i });
  const semCert = await semCertLocator.elementHandle();
  console.log('✓ Semantic Certification Checkbox resolved:', semCert !== null);

  // 4. Resolve Submit Button
  const semSubmitLocator = page.getByRole('button', { name: /submit/i });
  const semSubmit = await semSubmitLocator.elementHandle();
  console.log('✓ Semantic Submit Button resolved:', semSubmit !== null);

  await browser.close();
}

testSemanticResolution().catch(console.error);
