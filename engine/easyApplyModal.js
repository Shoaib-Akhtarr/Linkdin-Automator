const path = require('path');
const fs = require('fs');
const questionEngine = require('./questionEngine');
const cvMatcher = require('./cvMatcher');
const pdfRenderer = require('./pdfRenderer');

class EasyApplyModal {
  constructor(browserBridge) {
    this.bridge = browserBridge;
  }

  /**
   * Locate the active modal or dialog element
   */
  async getActiveDialog(page) {
    const selectors = [
      'dialog[open]',
      '[data-testid="dialog"]',
      '[data-testid="dialog-content"]',
      '[data-sdui-screen*="EasyApply"]',
      '.jobs-easy-apply-modal',
      'div[role="dialog"]'
    ];

    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          return el;
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Handle the complete Easy Apply modal workflow
   */
  async handleModal(jobInfo, options = {}) {
    const page = await this.bridge.getPage();
    const update = (msg) => {
      if (options.onStatusUpdate) options.onStatusUpdate(msg);
      console.log(`[EasyApply] ${msg}`);
    };

    update(`Opening Easy Apply for: "${jobInfo.title}" at "${jobInfo.company}"...`);

    // 1. Wait for modal / dialog to appear (up to 7 seconds)
    let dialog = null;
    for (let i = 0; i < 14; i++) {
      dialog = await this.getActiveDialog(page);
      if (dialog) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (!dialog) {
      return { status: 'failed', message: 'Easy Apply modal dialog did not appear in DOM.' };
    }

    update('✓ Easy Apply modal dialog detected.');

    // Early Check: Does the modal indicate already applied?
    const initialText = (await dialog.innerText()).trim();
    if (/you('ve| have)? already applied|application was sent|application submitted/i.test(initialText)) {
      update('ℹ️ Modal confirms you already applied for this job.');
      await this.dismissModal(page);
      return { status: 'already_applied', message: 'Already applied according to LinkedIn modal' };
    }

    // Daily Easy Apply Quota Cap Check
    if (/you reached today's easy apply limit|limit easy apply submissions/i.test(initialText)) {
      update("🛑 You reached today's Easy Apply limit on LinkedIn. Easy Apply submissions are paused by LinkedIn until tomorrow.");
      const gotItBtn = await dialog.$('button:has-text("Got it"), button[aria-label*="Dismiss"], button.artdeco-button--primary');
      if (gotItBtn) await gotItBtn.click().catch(() => {});
      await this.dismissModal(page);
      return { status: 'limit_reached', message: 'LinkedIn Daily Easy Apply limit reached' };
    }

    let stepCount = 0;
    const maxSteps = 12;
    let lastDialogFingerprint = '';
    let stuckCount = 0;

    let resumeHandled = false;

    while (stepCount < maxSteps) {
      stepCount++;

      if (options.isCancelled && options.isCancelled()) {
        update('⏹ Modal processing cancelled by user. Dismissing dialog...');
        await this.dismissModal(page);
        return { status: 'cancelled', message: 'Cancelled by user.' };
      }

      await this.bridge.humanDelay(500, 900);
      update(`Processing modal step ${stepCount}...`);

      dialog = await this.getActiveDialog(page);
      if (!dialog) {
        update('Modal dialog closed. Running Two-Step Verification to check if application truly succeeded...');
        const verification = await this.verifyApplicationSubmitted(page, null, update);
        if (verification.verified) {
          return { status: 'applied', message: verification.message };
        }
        return { status: 'failed', message: verification.reason || 'Modal closed prematurely without confirmation receipt.' };
      }

      // Check current page fingerprint to prevent getting stuck
      const currentFingerprint = (await dialog.innerText()).slice(0, 200).replace(/\s+/g, ' ');
      if (currentFingerprint === lastDialogFingerprint) {
        stuckCount++;
        if (stuckCount >= 3) {
          update('⚠️ Form screen has not changed after 2 consecutive button clicks. Checking for blocking errors...');
          const blockingError = await this.checkForErrors(dialog, page);
          if (blockingError) {
            update(`Blocked by field requirement: "${blockingError}". Dismissing dialog.`);
            return { status: 'blocked', message: blockingError };
          }
        }
      } else {
        stuckCount = 0;
        lastDialogFingerprint = currentFingerprint;
      }

      // 2. Fill form inputs in current step with full job intelligence context
      await this.fillCurrentStep(page, dialog, update, jobInfo);
      await this.bridge.humanDelay(300, 600);

      // 3. Handle resume selection if on a resume step
      if (!resumeHandled) {
        const handled = await this.handleResumeSelection(page, dialog, update, jobInfo, options);
        if (handled) resumeHandled = true;
      }

      // 4. Find primary action buttons strictly INSIDE the dialog
      const submitBtn = await this.findButtonInDialog(dialog, 'submit');
      const reviewBtn = await this.findButtonInDialog(dialog, 'review');
      const nextBtn = await this.findButtonInDialog(dialog, 'next');

      // CASE A: FINAL SUBMISSION BUTTON VISIBLE
      if (submitBtn) {
        update('Reached final submission step.');

        if (options.mode === 'hybrid' || options.mode === 'review') {
          update('⚠️ Application filled and waiting for review in Hybrid Mode. Review in Chrome or approve via Dashboard.');
          return {
            status: 'needs_review',
            message: 'Application filled and waiting on review/submit screen.'
          };
        } else {
          update('Autonomous Mode: Clicking "Submit application"...');
          await submitBtn.click({ force: true });
          await this.bridge.humanDelay(2000, 3000);

          // RUN 2-STEP VERIFICATION!
          const verification = await this.verifyApplicationSubmitted(page, dialog, update);
          if (verification.verified) {
            return { status: 'applied', message: verification.message };
          }
          return { status: 'failed', message: verification.reason || 'Submission not confirmed by 2-step verification.' };
        }
      }

      // CASE B: REVIEW BUTTON
      if (reviewBtn) {
        update('Clicking "Review" button...');
        await reviewBtn.click({ force: true });
        await this.bridge.humanDelay(600, 1000);
        continue;
      }

      // CASE C: NEXT BUTTON
      if (nextBtn) {
        update('Clicking "Next" button...');
        await nextBtn.click({ force: true });
        await this.bridge.humanDelay(800, 1400);

        // Check if blocked by validation error
        const hasError = await this.checkForErrors(dialog, page);
        if (hasError) {
          update(`Validation error on step ${stepCount}: "${hasError}". Attempting to fix and refill...`);
          await this.fillCurrentStep(page, dialog, update, jobInfo);
          await this.bridge.humanDelay(400, 700);
          const retryNext = await this.findButtonInDialog(dialog, 'next');
          if (retryNext) {
            await retryNext.click({ force: true });
            await this.bridge.humanDelay(800, 1400);
          }
        }
        continue;
      }

      // Check if finished with Done button
      const doneBtn = await page.$('button:has-text("Done")');
      if (doneBtn && await doneBtn.isVisible()) {
        await doneBtn.click();
        const verification = await this.verifyApplicationSubmitted(page, null, update);
        if (verification.verified) {
          return { status: 'applied', message: verification.message };
        }
        return { status: 'applied', message: 'Application completed with Done button.' };
      }

      // AI Self-Healing: Call Groq Advisor to diagnose next action if button is missing
      try {
        const groqAdvisor = require('./groqAdvisor');
        if (groqAdvisor && groqAdvisor.isAvailable()) {
          const advice = await groqAdvisor.adviseNextAction(page, 'No Next/Review/Submit button found in LinkedIn dialog');
          if (advice && advice.action === 'click') {
            const clicked = await groqAdvisor.executeAdvice(page, advice, update);
            if (clicked) {
              await this.bridge.humanDelay(1000, 2000);
              continue;
            }
          }
        }
      } catch (_) {}

      update('No Next/Review/Submit button found. Verifying current modal state...');
      const verification = await this.verifyApplicationSubmitted(page, dialog, update);
      if (verification.verified) {
        return { status: 'applied', message: verification.message };
      }
      break;
    }

    return { status: 'failed', message: 'Application was not submitted: unanswered questions or unable to advance modal steps.' };
  }

  /**
   * Helper to find first visible AND enabled action button strictly inside the dialog
   */
  async findButtonInDialog(dialog, actionType) {
    if (!dialog) return null;
    try {
      const buttons = await dialog.$$('footer button, button');
      for (const btn of buttons) {
        if (!(await btn.isVisible())) continue;
        const disabled = await btn.isDisabled().catch(() => false);
        if (disabled) continue;

        const text = (await btn.innerText()).trim().toLowerCase();
        const aria = (await btn.getAttribute('aria-label') || '').toLowerCase();

        // Skip navigation and dismiss controls
        if (text.includes('back') || aria.includes('back') || aria.includes('dismiss') || text.includes('cancel')) {
          continue;
        }

        if (actionType === 'submit') {
          if (text === 'submit application' || text === 'submit' || aria.includes('submit application') || aria.includes('submit')) {
            return btn;
          }
        } else if (actionType === 'review') {
          if (text === 'review' || aria.includes('review your application') || aria === 'review') {
            return btn;
          }
        } else if (actionType === 'next') {
          if (text === 'next' || aria.includes('continue to next') || aria.includes('next step') || aria === 'next') {
            return btn;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * Handle resume selection dynamically matching role requirements or synthesizing on-the-fly ATS CV
   */
  async handleResumeSelection(page, dialog, update, jobInfo, options = {}) {
    try {
      const dialogText = await dialog.innerText().catch(() => '');
      const fileInputs = await page.$$('input[type="file"]');
      const hasFileInput = fileInputs.length > 0;
      const isResumeStep = /resume|curriculum vitae|\bcv\b/i.test(dialogText) || hasFileInput;
      if (!isResumeStep) return false;

      const dynamicCVEnabled = options.settings?.intelligence?.dynamicCVGeneration !== false;

      // 1. DYNAMIC ATS CV GENERATION & DIRECT UPLOAD (Priority 1)
      if (dynamicCVEnabled && hasFileInput) {
        try {
          update(`🛠️ Dynamic CV: Synthesizing tailored ATS-compliant CV for "${jobInfo.title}" at "${jobInfo.company}"...`);
          const tailored = await pdfRenderer.renderTailoredCV(jobInfo);
          jobInfo.tailoredCV = tailored.fileName;
          update(`📄 Generated tailored ATS CV: "${tailored.fileName}" (${Math.round(tailored.fileSize / 1024)} KB)`);

          update(`📤 Uploading tailored ATS CV directly to LinkedIn application...`);
          await fileInputs[0].setInputFiles(tailored.filePath);
          await this.bridge.humanDelay(2000, 3000);
          update(`✓ Tailored ATS CV successfully uploaded and selected!`);
          return true;
        } catch (genErr) {
          update(`⚠️ Dynamic CV generation/upload note: ${genErr.message}. Falling back to pre-uploaded CV.`);
        }
      }

      // 2. FALLBACK: MATCH BEST PRE-UPLOADED CV OR DISK CV
      const cvDecision = cvMatcher.matchBestCV(jobInfo || {});
      update(`🎯 Pre-uploaded match: "${cvDecision.role}" -> Target CV: "${cvDecision.targetFile}" (Score: ${cvDecision.score})`);

      // Find all resume radio buttons on LinkedIn
      const radios = await page.$$('dialog input[type="radio"], [data-testid="dialog"] input[type="radio"], input[type="radio"]');
      if (radios.length > 0) {
        let selected = false;

        for (const radio of radios) {
          const parentText = await radio.evaluate(r => {
            const card = r.closest('label') || r.closest('li') || r.closest('div');
            return card ? card.innerText : '';
          });

          const matchesTarget = cvDecision.linkedInMatches.some(pat =>
            parentText.toLowerCase().includes(pat.toLowerCase())
          ) || parentText.toLowerCase().includes(cvDecision.targetFile.toLowerCase());

          if (matchesTarget) {
            update(`✓ Selected matching specialized CV on LinkedIn: "${cvDecision.targetFile}"`);
            await radio.scrollIntoViewIfNeeded().catch(() => {});
            await radio.evaluate(r => r.click()).catch(() => radio.click({ force: true }));
            await this.bridge.humanDelay(500, 800);
            selected = true;
            break;
          }
        }

        if (!selected) {
          let anyChecked = false;
          for (const r of radios) {
            if (await r.isChecked().catch(() => false)) { anyChecked = true; break; }
          }
          if (!anyChecked && radios.length > 0) {
            update(`Target not found in pre-uploaded list, selected default resume.`);
            await radios[0].scrollIntoViewIfNeeded().catch(() => {});
            await radios[0].evaluate(r => r.click()).catch(() => radios[0].click({ force: true }));
            await this.bridge.humanDelay(400, 700);
          }
        }
        return true;
      }

      // If file input exists and no radios were matched, try uploading static CV from disk
      if (hasFileInput && fs.existsSync(cvDecision.localPath)) {
        update(`Attaching fallback resume from disk: ${cvDecision.targetFile}`);
        await fileInputs[0].setInputFiles(cvDecision.localPath);
        await this.bridge.humanDelay(1500, 2500);
        return true;
      }

      return false;
    } catch (e) {
      console.warn('Resume selection note:', e.message);
      return false;
    }
  }

  /**
   * Fill form inputs in the active modal step
   */
  async fillCurrentStep(page, dialog, update, jobInfo = {}) {
    const scope = dialog || (await this.getActiveDialog(page)) || page;

    // 1. Text, Number, Tel, and general Text-like Inputs
    const textInputs = await scope.$$(
      'input[type="text"], input[type="number"], input[type="tel"], input:not([type])'
    );

    for (const input of textInputs) {
      if (!(await input.isVisible().catch(() => false))) continue;
      const currentVal = (await input.inputValue().catch(() => '') || '').trim();
      const isInvalid = (await input.getAttribute('aria-invalid')) === 'true' ||
        await input.evaluate(el => {
          const container = el.closest('div') || el.parentElement;
          return !!container && (
            container.innerText.includes('Invalid input') || 
            container.innerText.includes('Enter a whole number') || 
            container.innerText.includes('Please enter a valid') ||
            container.innerText.includes('This field is required')
          );
        }).catch(() => false);

      const isErrantYesNo = currentVal.toLowerCase() === 'yes' || currentVal.toLowerCase() === 'no';

      if (currentVal.length > 0 && !isInvalid && !isErrantYesNo) {
        // Keep valid pre-filled contact details (e.g. phone, email)
        continue;
      }

      const label = await this.getFieldLabel(page, input);
      const isNumber = (await input.getAttribute('type')) === 'number' || /years|how many|experience|salary|gpa|zip|postal|phone|code/i.test(label);
      const evaluation = await questionEngine.evaluateQuestionWithAI(label, isNumber ? 'number' : 'text', [], jobInfo);

      update(`Filling input "${label || 'field'}" -> "${evaluation.answer}"`);
      await input.fill('').catch(() => {});
      await input.fill(String(evaluation.answer)).catch(() => {});
      await this.bridge.humanDelay(300, 500);

      // Handle typeahead suggestions if present (e.g. city / location / country)
      try {
        const listbox = await page.$('div[role="listbox"], .basic-typeahead__selectable-list');
        if (listbox && await listbox.isVisible()) {
          const firstOption = await listbox.$('div[role="option"], li');
          if (firstOption) {
            await firstOption.click();
            await this.bridge.humanDelay(300, 500);
          }
        }
      } catch (e) {}
    }

    // 2. Textareas
    const textareas = await scope.$$('textarea');
    for (const textarea of textareas) {
      if (!(await textarea.isVisible().catch(() => false))) continue;
      const currentVal = (await textarea.inputValue().catch(() => '') || '').trim();
      if (currentVal.length > 0) continue;

      const label = await this.getFieldLabel(page, textarea);
      const evaluation = await questionEngine.evaluateQuestionWithAI(label, 'textarea', [], jobInfo);
      update(`Filling textarea "${label || 'summary'}" -> "${evaluation.answer}"`);
      await textarea.fill(String(evaluation.answer)).catch(() => {});
      await this.bridge.humanDelay(300, 600);
    }

    // 3. Dropdowns (<select>)
    const selects = await scope.$$('select');
    for (const select of selects) {
      if (!(await select.isVisible().catch(() => false))) continue;
      const label = await this.getFieldLabel(page, select);
      const options = await select.$$eval('option', opts =>
        opts.map(o => ({ value: o.value, text: o.text.trim() })).filter(t => t.text.length > 0)
      ).catch(() => []);
      if (options.length === 0) continue;

      const optionTexts = options.map(o => o.text);
      const evaluation = await questionEngine.evaluateQuestionWithAI(label, 'select', optionTexts, jobInfo);

      update(`Selecting dropdown "${label}" -> "${evaluation.answer}"`);

      // Match option
      const cleanAnswer = String(evaluation.answer).toLowerCase().trim();
      const matchedOpt = options.find(o => o.text.toLowerCase().trim() === cleanAnswer)
        || options.find(o => o.text.toLowerCase().includes(cleanAnswer))
        || options.find(o => o.value.toLowerCase().trim() === cleanAnswer)
        || (options.length > 1 && !options[0].text.toLowerCase().includes('select') ? options[0] : options[1] || options[0]);

      if (matchedOpt) {
        try {
          await select.selectOption({ value: matchedOpt.value }, { timeout: 2000 });
        } catch (e) {
          await select.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, matchedOpt.value).catch(() => {});
        }
      }
      await this.bridge.humanDelay(250, 450);
    }

    // 3b. LinkedIn Custom Comboboxes / Dropdowns (div[role="combobox"] / button[aria-haspopup="listbox"])
    const comboboxes = await scope.$$('[role="combobox"], button[aria-haspopup="listbox"]');
    for (const combo of comboboxes) {
      if (!(await combo.isVisible().catch(() => false))) continue;
      const tagName = await combo.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tagName === 'input') continue;

      const label = await this.getFieldLabel(page, combo);
      const currentText = (await combo.innerText().catch(() => '')).trim();
      if (currentText && !currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('choose')) {
        continue;
      }

      const evaluation = await questionEngine.evaluateQuestionWithAI(label, 'select', [], jobInfo);
      update(`Opening custom dropdown "${label}" -> "${evaluation.answer}"`);
      await combo.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(400, 700);

      const dropdownOpts = await page.$$('[role="listbox"] [role="option"], [role="listbox"] li, .artdeco-dropdown__content li');
      if (dropdownOpts.length > 0) {
        const cleanAnswer = String(evaluation.answer).toLowerCase().trim();
        let clicked = false;
        for (const opt of dropdownOpts) {
          const optText = (await opt.innerText().catch(() => '')).trim().toLowerCase();
          if (optText === cleanAnswer || optText.includes(cleanAnswer)) {
            await opt.click({ force: true }).catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked && dropdownOpts.length > 0) {
          await dropdownOpts[0].click({ force: true }).catch(() => {});
        }
      }
      await this.bridge.humanDelay(300, 500);
    }

    // 4. Radio Groups (SDUI and classic fieldsets)
    const radioGroups = await scope.$$(
      'fieldset, div[role="radiogroup"], [data-test-form-builder-radio-group], .fb-radio-buttons, .jobs-easy-apply-form-section__grouping:has(input[type="radio"])'
    );
    for (const grp of radioGroups) {
      if (!(await grp.isVisible().catch(() => false))) continue;

      // Extract question text
      let question = '';
      const legend = await grp.$('legend, [role="heading"], label, p, h3');
      if (legend) question = (await legend.innerText().catch(() => '')).trim();

      if (!question) {
        const parent = await grp.evaluateHandle(el => el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, div[data-test-form-builder-group]') || el.parentElement);
        if (parent) {
          question = await parent.evaluate(el => {
            const p = el.querySelector('p, h3, label, legend, span.t-14');
            return p ? p.innerText.trim() : '';
          }).catch(() => '');
        }
      }
      if (!question) {
        const radioDiv = await grp.$('div[role="radio"]');
        if (radioDiv) {
          question = (await radioDiv.getAttribute('aria-label') || '').trim();
        }
      }
      if (!question) question = 'Question';

      // Collect options: check div[role="radio"] first, then input[type="radio"]
      const radioDivs = await grp.$$('div[role="radio"]');
      const options = [];

      if (radioDivs.length > 0) {
        for (const rDiv of radioDivs) {
          const text = (await rDiv.innerText().catch(() => '')).trim();
          const isChecked = (await rDiv.getAttribute('aria-checked')) === 'true';
          options.push({ element: rDiv, text, isChecked });
        }
      } else {
        const inputs = await grp.$$('input[type="radio"]');
        for (const input of inputs) {
          const id = await input.getAttribute('id');
          let labelText = '';
          if (id) {
            const l = await page.$(`label[for="${id}"]`);
            if (l) labelText = (await l.innerText().catch(() => '')).trim();
          }
          if (!labelText) {
            labelText = await input.evaluate(el => {
              const p = el.closest('label') || el.parentElement;
              return p ? p.innerText.trim() : '';
            }).catch(() => '');
          }
          const isChecked = await input.isChecked().catch(() => false);
          options.push({ element: input, text: labelText, isChecked });
        }
      }

      if (options.length === 0) continue;

      // Check if already answered
      const alreadyChecked = options.some(o => o.isChecked);
      if (alreadyChecked) continue;

      const evalResult = await questionEngine.evaluateQuestionWithAI(question, 'radio', options.map(o => o.text), jobInfo);
      const cleanAnswer = String(evalResult.answer).toLowerCase().trim();

      const target = options.find(o => o.text.toLowerCase().trim() === cleanAnswer)
        || options.find(o => o.text.toLowerCase().includes(cleanAnswer))
        || options[0];

      if (target && !target.isChecked) {
        update(`Selecting radio "${question.slice(0, 50)}..." -> "${target.text}"`);
        await target.element.scrollIntoViewIfNeeded().catch(() => {});
        await target.element.click({ force: true }).catch(async () => {
          await target.element.evaluate(el => el.click()).catch(() => {});
        });
        await this.bridge.humanDelay(250, 450);
      }
    }

    // 5. Checkboxes (Agreements & Qualifications)
    const checkboxes = await scope.$$('input[type="checkbox"], div[role="checkbox"]');
    for (const cb of checkboxes) {
      if (!(await cb.isVisible().catch(() => false))) continue;
      const id = await cb.getAttribute('id') || '';
      const name = await cb.getAttribute('name') || '';

      // Skip "Follow company"
      if (/follow/i.test(id) || /follow/i.test(name)) {
        if (await cb.isChecked().catch(() => false)) {
          await cb.uncheck().catch(() => {});
          update('Unchecked "Follow company".');
        }
        continue;
      }

      // Check agreement / terms / qualification checkboxes if required or unchecked
      const isChecked = await cb.isChecked().catch(() => false);
      if (!isChecked) {
        const isRequired = (await cb.getAttribute('required')) !== null || (await cb.getAttribute('aria-required')) === 'true';
        const label = await this.getFieldLabel(page, cb);
        if (isRequired || /agree|certify|acknowledge|confirm|terms|privacy|consent/i.test(label)) {
          update(`Checking agreement/qualification checkbox: "${label || 'Terms'}"`);
          await cb.check({ force: true }).catch(() => cb.evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })).catch(() => {});
          await this.bridge.humanDelay(200, 400);
        }
      }
    }
  }

  /**
   * Helper to retrieve a human-readable label for any form element
   */
  async getFieldLabel(page, element) {
    try {
      const ariaLabel = await element.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      const ariaLabelledBy = await element.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const labelEl = await page.$(`#${ariaLabelledBy}`);
        if (labelEl) {
          const text = (await labelEl.innerText().catch(() => '')).trim();
          if (text) return text;
        }
      }

      const id = await element.getAttribute('id');
      if (id) {
        const labelEl = await page.$(`label[for="${id}"]`);
        if (labelEl) {
          const text = (await labelEl.innerText().catch(() => '')).trim();
          if (text) return text;
        }
      }

      const placeholder = await element.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      const parentLabel = await element.evaluate(el => {
        const formElement = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, .fb-form-element, div[data-test-form-builder-group]');
        if (formElement) {
          const title = formElement.querySelector('label, [role="heading"], legend, .fb-form-element-label, span.t-14, p');
          if (title && title.innerText) return title.innerText.trim();
        }
        const lbl = el.closest('label') || el.closest('div')?.querySelector('label, p, span');
        return lbl ? lbl.innerText.trim() : '';
      }).catch(() => '');
      if (parentLabel && parentLabel.trim()) return parentLabel.trim();

      return '';
    } catch (e) {
      return '';
    }
  }

  async checkForErrors(dialog, page) {
    try {
      const scope = dialog || page;
      const errorEl = await scope.$(
        '.artdeco-inline-feedback--error, [data-test-form-builder-error], .fb-form-element__error, p[role="alert"], p:has-text("This field is required"), p:has-text("Please enter a valid"), p:has-text("Please make a selection")'
      );
      if (errorEl && await errorEl.isVisible()) {
        return (await errorEl.innerText()).trim();
      }
    } catch (e) {}
    return null;
  }

  /**
   * Two-Step Verification System:
   * Verifies beyond doubt whether the application was truly submitted.
   * Step 1: In-Modal Success Receipt (Explicit "Application sent" / "Done" confirmation)
   * Step 2: Post-Modal Job Card State Audit (Job card badge changed to "Applied" / Easy Apply button gone)
   */
  async verifyApplicationSubmitted(page, dialog, update = () => {}) {
    update('🔍 Running Two-Step Verification: Auditing submission receipts...');

    // ----------------------------------------------------
    // STEP 1: In-Modal Success Confirmation Receipt
    // ----------------------------------------------------
    let step1Passed = false;
    let proofMessage = '';

    // Wait up to 6 seconds for submission response
    for (let i = 0; i < 6; i++) {
      await this.bridge.humanDelay(800, 1200);

      // Check if there are blocking inline validation errors
      const currentDialog = await this.getActiveDialog(page);
      if (currentDialog) {
        const error = await this.checkForErrors(currentDialog, page);
        if (error) {
          update(`❌ Verification Step 1 FAILED: Blocking validation error present: "${error}". Application NOT submitted.`);
          return { 
            verified: false, 
            status: 'failed', 
            reason: `Validation error: ${error}`,
            error
          };
        }

        // Check if modal text explicitly confirms submission
        const text = (await currentDialog.innerText().catch(() => '')).toLowerCase();
        if (
          text.includes('your application was sent') ||
          text.includes('application submitted') ||
          text.includes('application was submitted') ||
          text.includes('application sent')
        ) {
          step1Passed = true;
          proofMessage = 'Modal confirmed: Application was sent';
          break;
        }

        // Check for Done button
        const doneBtn = await page.$(
          'button:has-text("Done"), [data-control-name="save_application_and_close"], .artdeco-modal button:has-text("Done"), button[aria-label="Done"]'
        );
        if (doneBtn && await doneBtn.isVisible().catch(() => false)) {
          step1Passed = true;
          proofMessage = 'Modal confirmed: Done button received';
          await doneBtn.click({ force: true }).catch(() => {});
          await this.bridge.humanDelay(1000, 1500);
          break;
        }
      } else {
        // Dialog disappeared - proceed to Step 2
        break;
      }
    }

    // If modal is still open with form fields, it did NOT submit!
    const remainingDialog = await this.getActiveDialog(page);
    if (remainingDialog) {
      const remainingInputs = await remainingDialog.$$('input, textarea, select');
      if (remainingInputs.length > 0) {
        const err = await this.checkForErrors(remainingDialog, page) || 'Unanswered questions or required fields prevented submission';
        update(`❌ Verification Step 1 FAILED: Modal remains open with unanswered fields. ${err}`);
        return {
          verified: false,
          status: 'failed',
          reason: err
        };
      }
    }

    // ----------------------------------------------------
    // STEP 2: Post-Modal Job Card State Audit on LinkedIn Page
    // ----------------------------------------------------
    update('🔍 Running Verification Step 2: Checking LinkedIn job card for "Applied" status...');
    await this.bridge.humanDelay(1500, 2500);

    let step2Passed = false;
    let cardProof = '';

    const verificationSelectors = [
      '.jobs-s-apply__applied-date',
      '.artdeco-inline-feedback--success',
      'span.artdeco-inline-feedback__message',
      '.jobs-details-top-card__actions-container span:has-text("Applied")',
      '.jobs-unified-top-card__actions-container span:has-text("Applied")',
      '.jobs-details-top-card:has-text("Applied")',
      '[data-view-name="job-details"] :has-text("Applied on")',
      '[data-view-name="job-details"] :has-text("Applied ")'
    ];

    for (const sel of verificationSelectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          const txt = (await el.innerText()).trim();
          if (/applied/i.test(txt)) {
            step2Passed = true;
            cardProof = `Job card badge confirms "${txt}"`;
            break;
          }
        }
      } catch (_) {}
    }

    // Check if "Easy Apply" button is gone or replaced
    const easyApplyButtonStillPresent = await page.$(
      'button.jobs-apply-button:has-text("Easy Apply"), button[aria-label*="Easy Apply"]'
    );
    const isEasyApplyVisible = easyApplyButtonStillPresent && await easyApplyButtonStillPresent.isVisible().catch(() => false);

    if (step1Passed && step2Passed) {
      update(`🎉 [2-Step Verification PASSED] Step 1: ${proofMessage} | Step 2: ${cardProof}`);
      return { verified: true, status: 'applied', message: `Confirmed via 2-step verification (${proofMessage} + ${cardProof})` };
    }

    if (step1Passed && !isEasyApplyVisible) {
      update(`✓ [Verification PASSED] Modal confirmed submission (${proofMessage}) and Easy Apply button successfully closed.`);
      return { verified: true, status: 'applied', message: `Confirmed submission (${proofMessage})` };
    }

    if (step2Passed) {
      update(`✓ [Verification PASSED] Job card confirms: ${cardProof}`);
      return { verified: true, status: 'applied', message: `Confirmed via job card: ${cardProof}` };
    }

    // If Easy Apply button is STILL active on screen:
    if (isEasyApplyVisible) {
      update('❌ [2-Step Verification FAILED] "Easy Apply" button is still active on LinkedIn job card. Application was NOT accepted.');
      return {
        verified: false,
        status: 'failed',
        reason: 'Easy Apply button remained active; submission was rejected or dropped by LinkedIn.'
      };
    }

    update('⚠️ [2-Step Verification WARNING] Modal closed without explicit confirmation receipt.');
    return {
      verified: false,
      status: 'unverified',
      reason: 'Application modal closed without receiving Done button or confirmation badge.'
    };
  }

  async closeSuccessModal(page, update = () => {}) {
    try {
      const doneBtn = await page.waitForSelector(
        'button:has-text("Done"), [data-control-name="save_application_and_close"], button[aria-label="Done"], .artdeco-modal button:has-text("Done")',
        { timeout: 5000 }
      );
      if (doneBtn) {
        await doneBtn.click({ force: true });
        update('Clicked "Done" on submission confirmation.');
        return true;
      }
    } catch (e) {}
    return false;
  }

  async dismissModal(page) {
    try {
      const dialog = await this.getActiveDialog(page);
      if (!dialog) return;

      const dismissBtn = await dialog.$('button[aria-label="Dismiss"], button:has-text("Dismiss")');
      if (dismissBtn && await dismissBtn.isVisible()) {
        await dismissBtn.click({ force: true });
        await this.bridge.humanDelay(800, 1500);

        const discardBtn = await page.$(
          'button:has-text("Discard"), button[data-control-name="discard_application_confirm_btn"]'
        );
        if (discardBtn && await discardBtn.isVisible()) {
          await discardBtn.click({ force: true });
          await this.bridge.humanDelay(500, 1000);
        }
      }
    } catch (e) {}
  }
}

module.exports = EasyApplyModal;
