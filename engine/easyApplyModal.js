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
      await this.bridge.humanDelay(1000, 1800);
      update(`Processing modal step ${stepCount}...`);

      dialog = await this.getActiveDialog(page);
      if (!dialog) {
        update('Modal dialog closed. Checking if application succeeded...');
        const doneBtn = await page.$('button:has-text("Done")');
        if (doneBtn && await doneBtn.isVisible()) {
          await doneBtn.click();
          return { status: 'applied', message: 'Application finished successfully.' };
        }
        return { status: 'applied', message: 'Application completed (dialog closed).' };
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
      await this.bridge.humanDelay(600, 1000);

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
          await this.bridge.humanDelay(2500, 4500);
          await this.closeSuccessModal(page, update);
          return { status: 'applied', message: 'Application submitted successfully.' };
        }
      }

      // CASE B: REVIEW BUTTON
      if (reviewBtn) {
        update('Clicking "Review" button...');
        await reviewBtn.click({ force: true });
        await this.bridge.humanDelay(1500, 2500);
        continue;
      }

      // CASE C: NEXT BUTTON
      if (nextBtn) {
        update('Clicking "Next" button...');
        await nextBtn.click({ force: true });
        await this.bridge.humanDelay(1500, 2500);

        // Check if blocked by validation error
        const hasError = await this.checkForErrors(dialog, page);
        if (hasError) {
          update(`Validation error on step ${stepCount}: "${hasError}". Attempting to fix...`);
          await this.fillCurrentStep(page, dialog, update, jobInfo);
          await this.bridge.humanDelay(1000, 1500);
          const retryNext = await this.findButtonInDialog(dialog, 'next');
          if (retryNext) {
            await retryNext.click({ force: true });
            await this.bridge.humanDelay(1500, 2500);
          }
        }
        continue;
      }

      // Check if finished with Done button
      const doneBtn = await page.$('button:has-text("Done")');
      if (doneBtn && await doneBtn.isVisible()) {
        await doneBtn.click();
        return { status: 'applied', message: 'Application completed with Done button.' };
      }

      update('No Next/Review/Submit button found. Dialog may be completed.');
      break;
    }

    return { status: 'applied', message: 'Application processed through available steps.' };
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
    // 1. Text, Number, and Tel Inputs
    const textInputs = await page.$$(
      'dialog input[type="text"], dialog input[type="number"], dialog input[type="tel"], [data-testid="dialog"] input[type="text"], [data-testid="dialog"] input[type="number"], [data-testid="dialog"] input[type="tel"]'
    );

    for (const input of textInputs) {
      if (!(await input.isVisible())) continue;
      const currentVal = (await input.inputValue() || '').trim();
      const isInvalid = (await input.getAttribute('aria-invalid')) === 'true' ||
        await input.evaluate(el => {
          const container = el.closest('div') || el.parentElement;
          return !!container && (container.innerText.includes('Invalid input') || container.innerText.includes('Enter a whole number'));
        }).catch(() => false);

      const isErrantYesNo = currentVal.toLowerCase() === 'yes' || currentVal.toLowerCase() === 'no';

      if (currentVal.length > 0 && !isInvalid && !isErrantYesNo) {
        // Keep valid pre-filled contact details
        continue;
      }

      const label = await this.getFieldLabel(page, input);
      const isNumber = (await input.getAttribute('type')) === 'number';
      const evaluation = questionEngine.evaluateQuestion(label, isNumber ? 'number' : 'text', [], jobInfo);

      update(`Filling input "${label || 'field'}" -> "${evaluation.answer}"`);
      await input.fill('');
      await input.fill(String(evaluation.answer));
      await this.bridge.humanDelay(300, 500);

      // Handle typeahead suggestions if present (e.g. city / location)
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
    const textareas = await page.$$('dialog textarea, [data-testid="dialog"] textarea');
    for (const textarea of textareas) {
      if (!(await textarea.isVisible())) continue;
      const currentVal = await textarea.inputValue();
      if (currentVal && currentVal.trim().length > 0) continue;

      const label = await this.getFieldLabel(page, textarea);
      const evaluation = questionEngine.evaluateQuestion(label, 'textarea', [], jobInfo);
      update(`Filling textarea "${label || 'summary'}" -> "${evaluation.answer}"`);
      await textarea.fill(String(evaluation.answer));
      await this.bridge.humanDelay(300, 600);
    }

    // 3. Dropdowns (<select>)
    const selects = await page.$$('dialog select, [data-testid="dialog"] select');
    for (const select of selects) {
      if (!(await select.isVisible())) continue;
      const label = await this.getFieldLabel(page, select);
      const options = await select.$$eval('option', opts =>
        opts.map(o => ({ value: o.value, text: o.text.trim() })).filter(t => t.text.length > 0)
      );
      const optionTexts = options.map(o => o.text);
      const evaluation = questionEngine.evaluateQuestion(label, 'select', optionTexts, jobInfo);

      update(`Selecting dropdown "${label}" -> "${evaluation.answer}"`);

      // Match option
      const cleanAnswer = String(evaluation.answer).toLowerCase().trim();
      const matchedOpt = options.find(o => o.text.toLowerCase().trim() === cleanAnswer)
        || options.find(o => o.text.toLowerCase().includes(cleanAnswer))
        || options.find(o => o.value.toLowerCase().trim() === cleanAnswer)
        || (options.length > 1 ? options[1] : options[0]);

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

    // 4. Radio Groups (SDUI and classic)
    const radioGroups = await page.$$(
      'dialog fieldset, [data-testid="dialog"] fieldset, dialog div[role="radiogroup"], [data-testid="dialog"] div[role="radiogroup"]'
    );
    for (const grp of radioGroups) {
      if (!(await grp.isVisible())) continue;

      // Extract question text
      let question = '';
      const parent = await grp.evaluateHandle(el => el.closest('[componentkey]') || el.parentElement);
      if (parent) {
        question = await parent.evaluate(el => {
          const p = el.querySelector('p, h3, label, legend');
          return p ? p.innerText.trim() : '';
        }).catch(() => '');
      }
      if (!question) {
        const legend = await grp.$('legend, [role="heading"]');
        if (legend) question = (await legend.innerText()).trim();
      }
      if (!question) {
        const radioDiv = await grp.$('div[role="radio"]');
        if (radioDiv) {
          question = (await radioDiv.getAttribute('aria-label') || '').trim();
        }
      }
      if (!question) continue;

      // Collect options: check div[role="radio"] first, then input[type="radio"]
      const radioDivs = await grp.$$('div[role="radio"]');
      const options = [];

      if (radioDivs.length > 0) {
        for (const rDiv of radioDivs) {
          const text = (await rDiv.innerText()).trim();
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
            if (l) labelText = (await l.innerText()).trim();
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

      const evalResult = questionEngine.evaluateQuestion(question, 'radio', options.map(o => o.text), jobInfo);
      const cleanAnswer = String(evalResult.answer).toLowerCase().trim();

      const target = options.find(o => o.text.toLowerCase().trim() === cleanAnswer)
        || options.find(o => o.text.toLowerCase().includes(cleanAnswer))
        || options[0];

      if (target && !target.isChecked) {
        update(`Selecting radio "${question.slice(0, 50)}..." -> "${target.text}"`);
        await target.element.scrollIntoViewIfNeeded().catch(() => {});
        await target.element.click({ force: true }).catch(async () => {
          await target.element.evaluate(el => el.click());
        });
        await this.bridge.humanDelay(250, 450);
      }
    }

    // 5. Checkboxes (Agreements & Qualifications)
    const checkboxes = await page.$$('dialog input[type="checkbox"], [data-testid="dialog"] input[type="checkbox"]');
    for (const cb of checkboxes) {
      if (!(await cb.isVisible())) continue;
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
        if (isRequired || /agree|certify|acknowledge|confirm|terms|privacy/i.test(label)) {
          update(`Checking agreement/qualification checkbox: "${label || 'Terms'}"`);
          await cb.check({ force: true }).catch(() => cb.evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }));
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

      const id = await element.getAttribute('id');
      if (id) {
        const labelEl = await page.$(`label[for="${id}"]`);
        if (labelEl) {
          const text = (await labelEl.innerText()).trim();
          if (text) return text;
        }
      }

      const placeholder = await element.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      const parentLabel = await element.evaluate(el => {
        const lbl = el.closest('label') || el.closest('div')?.querySelector('label, p, span');
        return lbl ? lbl.innerText : '';
      });
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
        '.artdeco-inline-feedback--error, [data-test-form-builder-error], .fb-form-element__error, p[role="alert"], p:has-text("This field is required"), p:has-text("Please enter a valid")'
      );
      if (errorEl && await errorEl.isVisible()) {
        return (await errorEl.innerText()).trim();
      }
    } catch (e) {}
    return null;
  }

  async closeSuccessModal(page, update) {
    try {
      const doneBtn = await page.waitForSelector('button:has-text("Done")', { timeout: 5000 });
      if (doneBtn) {
        await doneBtn.click({ force: true });
        update('Clicked "Done" on submission confirmation.');
      }
    } catch (e) {
      await this.dismissModal(page);
    }
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
