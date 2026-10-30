const path = require('path');
const fs = require('fs');
const questionEngine = require('./questionEngine');
const pdfRenderer = require('./pdfRenderer');
const eligibilityEngine = require('./eligibilityEngine');

class ExternalApplyEngine {
  constructor(browserBridge) {
    this.bridge = browserBridge;
  }

  /**
   * Main entrypoint for applying to external job postings
   * @param {Object} linkedInPage - Active Playwright page on LinkedIn
   * @param {Object} jobInfo - Job metadata { title, company, location, description, ... }
   * @param {Object} options - { mode, settings, onStatusUpdate }
   */
  async handleExternalApply(linkedInPage, jobInfo, options = {}) {
    const update = (msg) => {
      if (options.onStatusUpdate) options.onStatusUpdate(msg);
      console.log(`[ExternalApply] ${msg}`);
    };

    update(`🌐 Initiating External Application for: "${jobInfo.title}" at "${jobInfo.company}"...`);

    const context = linkedInPage.context();
    let externalPage = null;

    try {
      // 1. Locate and click external apply button / link
      const applyBtn = await this.findApplyButton(linkedInPage);
      if (!applyBtn) {
        return { status: 'skipped', message: 'No external Apply button found on LinkedIn page.' };
      }

      // Check if button is an <a> tag with direct external href
      const directHref = await applyBtn.getAttribute('href');

      // Setup new page listener before clicking
      const newPagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);

      await applyBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(1500, 2500);

      // Handle intermediate LinkedIn confirmation dialog if present
      await this.handleLinkedInRedirectModal(linkedInPage, update);

      externalPage = await newPagePromise;

      // Fallback: If no new tab opened, open direct link if available
      if (!externalPage && directHref && !directHref.startsWith('#')) {
        update(`Opening external career link in new tab: ${directHref.slice(0, 80)}...`);
        externalPage = await context.newPage();
        await externalPage.goto(directHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      if (!externalPage) {
        // Check if current page itself navigated away
        const currentUrl = linkedInPage.url();
        if (!currentUrl.includes('linkedin.com/jobs')) {
          externalPage = linkedInPage;
        } else {
          return { status: 'failed', message: 'Could not capture external career page tab.' };
        }
      }

      // 2. Wait for external page to load
      await externalPage.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(() => {});
      await this.bridge.humanDelay(2000, 3500);

      const targetUrl = externalPage.url();
      update(`✓ External career page loaded: ${targetUrl.slice(0, 90)}...`);

      if (options.isCancelled && options.isCancelled()) {
        update('⏹ External apply cancelled by user.');
        if (externalPage && externalPage !== linkedInPage) await externalPage.close().catch(() => {});
        return { status: 'cancelled', message: 'Cancelled by user.' };
      }

      // 3. Detect ATS platform & perform early gate check (Fast-Fail before CV generation)
      const platform = await this.detectPlatform(externalPage, targetUrl);
      update(`🔍 Detected Applicant Tracking System (ATS): ${platform.toUpperCase()}`);

      const isAutonomous = options.mode !== 'review' && options.settings?.execution?.pauseForReviewInHybridMode !== true;
      const hasAuthGate = (await externalPage.$('input[type="password"], a:has-text("Create Account"), button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("Log In")')) !== null;
      if (hasAuthGate && isAutonomous) {
        let tailoredCV = null;
        try {
          update(`📄 Pre-generating tailored ATS CV for "${jobInfo.title}" at "${jobInfo.company}"...`);
          tailoredCV = await pdfRenderer.renderTailoredCV(jobInfo);
          jobInfo.tailoredCV = tailoredCV.fileName;
          update(`✓ Synthesized tailored CV for handoff: ${tailoredCV.fileName}`);
        } catch (_) {}

        update(`⚠️ External portal requires manual account login (${jobInfo.company}). Saved tailored CV for candidate handoff.`);
        return {
          status: 'needs_user_login',
          message: 'External portal requires manual account login/password gate. Tailored CV ready.',
          tailoredCV: tailoredCV?.fileName,
          portalUrl: targetUrl
        };
      }

      // 4. Generate tailored ATS vector PDF only for viable applications
      let tailoredCV = null;
      try {
        update(`📄 Generating tailored ATS CV for "${jobInfo.title}" at "${jobInfo.company}"...`);
        tailoredCV = await pdfRenderer.renderTailoredCV(jobInfo);
        jobInfo.tailoredCV = tailoredCV.fileName;
        update(`✓ Synthesized tailored CV: ${tailoredCV.fileName} (${Math.round(tailoredCV.fileSize / 1024)} KB)`);
      } catch (cvErr) {
        update(`⚠️ Tailored CV generation note: ${cvErr.message}`);
      }

      let fillResult = null;
      if (platform === 'greenhouse') {
        fillResult = await this.fillGreenhouse(externalPage, jobInfo, tailoredCV, update, options);
      } else if (platform === 'lever') {
        fillResult = await this.fillLever(externalPage, jobInfo, tailoredCV, update, options);
      } else if (platform === 'ashby') {
        fillResult = await this.fillAshby(externalPage, jobInfo, tailoredCV, update, options);
      } else {
        fillResult = await this.fillGenericOrComplex(externalPage, jobInfo, tailoredCV, update, options);
      }

      return fillResult;

    } catch (err) {
      update(`❌ Error during external application: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }

  /**
   * Normalize ATS links to point directly to the application form
   */
  normalizeAtsUrl(url) {
    if (!url || typeof url !== 'string') return url;
    let clean = url.trim();

    // Ashby direct application URL
    if (clean.includes('jobs.ashbyhq.com') && !clean.includes('/application')) {
      clean = `${clean.replace(/\/+$/, '')}/application`;
    }
    // Lever direct apply URL
    else if (clean.includes('jobs.lever.co') && !clean.includes('/apply')) {
      clean = `${clean.replace(/\/+$/, '')}/apply`;
    }
    // Greenhouse direct app anchor
    else if (clean.includes('boards.greenhouse.io') && !clean.includes('#app')) {
      clean = `${clean}#app`;
    }

    return clean;
  }

  /**
   * Find external apply button on LinkedIn details view or external career pages
   * Supports auto-scroll, comprehensive ATS selectors, and cross-iframe traversal
   */
  async findApplyButton(page) {
    // 1. Scroll slightly down to trigger lazy-loaded buttons
    try {
      await page.evaluate(() => window.scrollBy(0, 350));
      await this.bridge.humanDelay(300, 500);
    } catch (_) {}

    const selectors = [
      'button.jobs-apply-button',
      'a.jobs-apply-button',
      'button[aria-label*="Apply to"]',
      'a[aria-label*="Apply to"]',
      'button:has-text("Apply on company website")',
      'a:has-text("Apply on company website")',
      'a[data-automation-id="adventureButton"]', // Workday primary apply button
      'a[data-automation-id="applyManually"]',   // Workday manual apply
      'button:has-text("Apply Manually")',
      'button:has-text("I\'m interested")',      // SmartRecruiters
      'a:has-text("I\'m interested")',
      'a:has-text("Apply for this job")',
      'button:has-text("Apply for this job")',
      'button:has-text("Apply Now")',
      'a:has-text("Apply Now")',
      'a[href*="/apply"]',
      'a[href*="#app"]',
      'button:has-text("Apply")',
      'a:has-text("Apply")'
    ];

    // 2. Search main document
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          const text = (await el.innerText()).trim().toLowerCase();
          // Skip if already applied
          if (text.includes('applied')) return null;
          return el;
        }
      } catch (e) {}
    }

    // 3. Search across all frames / iframes (BambooHR, embedded Greenhouse widgets, etc.)
    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        for (const sel of selectors) {
          try {
            const frameEl = await frame.$(sel);
            if (frameEl && await frameEl.isVisible()) {
              const text = (await frameEl.innerText()).trim().toLowerCase();
              if (text.includes('applied')) return null;
              return frameEl;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Handle LinkedIn's "You are being redirected" modal
   */
  async handleLinkedInRedirectModal(page, update) {
    try {
      const continueBtn = await page.$(
        'dialog button:has-text("Continue"), [data-testid="dialog"] button:has-text("Continue"), button:has-text("Continue to application"), button:has-text("Apply on company website")'
      );
      if (continueBtn && await continueBtn.isVisible()) {
        update('Acknowledged LinkedIn redirection dialog.');
        await continueBtn.click({ force: true });
        await this.bridge.humanDelay(1000, 2000);
      }
    } catch (e) {}
  }

  /**
   * Identify ATS architecture
   */
  async detectPlatform(page, url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('greenhouse.io') || lowerUrl.includes('gh_src')) return 'greenhouse';
    if (lowerUrl.includes('lever.co')) return 'lever';
    if (lowerUrl.includes('ashbyhq.com')) return 'ashby';
    if (lowerUrl.includes('myworkdayjobs.com') || lowerUrl.includes('workday')) return 'workday';
    if (lowerUrl.includes('smartrecruiters.com')) return 'smartrecruiters';

    // Check DOM cues
    try {
      const hasGreenhouseDOM = await page.$('#application_form, #first_name, #submit_app') !== null;
      if (hasGreenhouseDOM) return 'greenhouse';

      const hasLeverDOM = await page.$('.application-form, form[action*="lever"], button#create-application') !== null;
      if (hasLeverDOM) return 'lever';
    } catch (e) {}

    return 'generic';
  }

  /**
   * Auto-fill & submit Greenhouse application
   */
  async fillGreenhouse(page, jobInfo, tailoredCV, update, options) {
    update('Filling Greenhouse application fields...');

    // Navigate to form if on landing page with an "Apply" button
    const applyAnchor = await page.$('a[href*="#app"], a:has-text("Apply Now"), button:has-text("Apply")');
    if (applyAnchor && await applyAnchor.isVisible()) {
      await applyAnchor.click().catch(() => {});
      await this.bridge.humanDelay(1000, 1500);
    }

    const p = questionEngine.profile;
    const personal = p.personal || {};

    // 1. Personal & Contact
    await this.safeType(page, '#first_name, input[name="job_application[first_name]"]', personal.firstName || 'Shoaib');
    await this.safeType(page, '#last_name, input[name="job_application[last_name]"]', personal.lastName || 'Akhtar');
    await this.safeType(page, '#email, input[name="job_application[email]"]', personal.email || '');
    await this.safeType(page, '#phone, input[name="job_application[phone]"]', personal.phone || '');

    // 2. Social Links
    await this.safeType(page, 'input[autocomplete*="linkedin"], input[id*="linkedin"], input[name*="linkedin"]', personal.links?.linkedin || '');
    await this.safeType(page, 'input[autocomplete*="github"], input[id*="github"], input[name*="github"]', personal.links?.github || '');
    await this.safeType(page, 'input[id*="website"], input[name*="website"], input[id*="portfolio"]', personal.links?.portfolio || '');

    // 3. Upload Tailored ATS CV
    if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
      const resumeInput = await page.$('input[type="file"][id*="resume"], input[type="file"][name*="resume"], input[type="file"]');
      if (resumeInput) {
        update(`📤 Uploading tailored CV: ${tailoredCV.fileName}`);
        await resumeInput.setInputFiles(tailoredCV.filePath);
        await this.bridge.humanDelay(1500, 2500);
      }
    }

    // 4. Fill custom questions
    await this.fillStandardQuestions(page, jobInfo, update);

    // 5. Submit or Review
    return await this.finalizeExternalSubmission(page, '#submit_app, button:has-text("Submit Application"), input[type="submit"]', update, options);
  }

  /**
   * Auto-fill & submit Lever application
   */
  async fillLever(page, jobInfo, tailoredCV, update, options) {
    update('Filling Lever application form...');

    // If on job description page, click "Apply for this job"
    const applyBtn = await page.$('a.postings-btn, a:has-text("Apply for this job"), button:has-text("Apply")');
    if (applyBtn && await applyBtn.isVisible()) {
      await applyBtn.click().catch(() => {});
      await this.bridge.humanDelay(1500, 2500);
    }

    const p = questionEngine.profile;
    const personal = p.personal || {};

    // 1. Personal & Contact
    await this.safeType(page, 'input[name="name"]', personal.fullName || 'Shoaib Akhtar');
    await this.safeType(page, 'input[name="email"]', personal.email || '');
    await this.safeType(page, 'input[name="phone"]', personal.phone || '');
    await this.safeType(page, 'input[name="org"]', 'AppEvolve / Freelance AI Engineer');

    // 2. URLs
    await this.safeType(page, 'input[name="urls[LinkedIn]"], input[name*="LinkedIn"]', personal.links?.linkedin || '');
    await this.safeType(page, 'input[name="urls[GitHub]"], input[name*="GitHub"]', personal.links?.github || '');
    await this.safeType(page, 'input[name="urls[Portfolio]"], input[name*="Portfolio"]', personal.links?.portfolio || '');

    // 3. Tailored Cover Letter Note
    const commentsBox = await page.$('textarea[name="comments"], textarea[name*="additional"]');
    if (commentsBox && await commentsBox.isVisible()) {
      const evalResult = eligibilityEngine.evaluateEligibility(jobInfo);
      const coverNote = eligibilityEngine.generateTailoredCoverLetter(jobInfo, evalResult.matchedSkills);
      await commentsBox.fill(coverNote);
      update('✓ Injected customized cover letter into Lever comments field.');
    }

    // 4. Upload Resume
    if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
      const fileInput = await page.$('input[name="resume"], input[type="file"]');
      if (fileInput) {
        update(`📤 Uploading tailored CV: ${tailoredCV.fileName}`);
        await fileInput.setInputFiles(tailoredCV.filePath);
        await this.bridge.humanDelay(1500, 2500);
      }
    }

    // 5. Fill custom questions
    await this.fillStandardQuestions(page, jobInfo, update);

    // 6. Submit or Review
    return await this.finalizeExternalSubmission(page, 'button#create-application, button:has-text("Submit Application")', update, options);
  }

  /**
   * Auto-fill & submit Ashby application
   */
  async fillAshby(page, jobInfo, tailoredCV, update, options) {
    update('Filling Ashby application form...');

    const p = questionEngine.profile;
    const personal = p.personal || {};

    await this.safeType(page, 'input[name*="name"], input[placeholder*="Name"]', personal.fullName || 'Shoaib Akhtar');
    await this.safeType(page, 'input[name*="email"], input[type="email"]', personal.email || '');
    await this.safeType(page, 'input[name*="phone"], input[type="tel"]', personal.phone || '');

    if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        update(`📤 Uploading tailored CV: ${tailoredCV.fileName}`);
        await fileInput.setInputFiles(tailoredCV.filePath);
        await this.bridge.humanDelay(1500, 2500);
      }
    }

    await this.fillStandardQuestions(page, jobInfo, update);

    return await this.finalizeExternalSubmission(page, 'button[type="submit"], button:has-text("Submit Application")', update, options);
  }

  /**
   * Universal Autofill for Generic & Complex Portals (Workday, etc.)
   */
  async fillGenericOrComplex(page, jobInfo, tailoredCV, update, options) {
    update('Running Universal Field Matcher for career portal...');

    const p = questionEngine.profile;
    const personal = p.personal || {};

    // 1. Fill all identifiable input fields
    const inputs = await page.$$('input[type="text"], input[type="email"], input[type="tel"], textarea');
    for (const input of inputs) {
      if (!(await input.isVisible())) continue;
      const val = (await input.inputValue() || '').trim();
      if (val) continue; // Skip already filled fields

      const name = (await input.getAttribute('name') || '').toLowerCase();
      const id = (await input.getAttribute('id') || '').toLowerCase();
      const placeholder = (await input.getAttribute('placeholder') || '').toLowerCase();
      const labelText = await page.evaluate(el => {
        const lbl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        return lbl ? lbl.innerText.toLowerCase() : '';
      }, input);

      const combined = `${name} ${id} ${placeholder} ${labelText}`;

      if (/first.*name|fname/i.test(combined)) {
        await input.fill(personal.firstName || 'Shoaib');
      } else if (/last.*name|lname/i.test(combined)) {
        await input.fill(personal.lastName || 'Akhtar');
      } else if (/full.*name|your.*name|applicant.*name/i.test(combined)) {
        await input.fill(personal.fullName || 'Shoaib Akhtar');
      } else if (/email/i.test(combined)) {
        await input.fill(personal.email || '');
      } else if (/phone|mobile|tel/i.test(combined)) {
        await input.fill(personal.phone || '');
      } else if (/linkedin/i.test(combined)) {
        await input.fill(personal.links?.linkedin || '');
      } else if (/github/i.test(combined)) {
        await input.fill(personal.links?.github || '');
      } else if (/city/i.test(combined)) {
        await input.fill(personal.address?.city || 'Lahore');
      }
    }

    // 2. Upload Tailored CV
    if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        update(`📤 Uploading tailored ATS CV to career portal...`);
        await fileInput.setInputFiles(tailoredCV.filePath).catch(() => {});
        await this.bridge.humanDelay(1500, 2500);
      }
    }

    // 3. Detect if portal requires account creation / login (e.g. Workday)
    const hasAuthGate = (await page.$('input[type="password"], a:has-text("Create Account"), button:has-text("Sign In")')) !== null;

    if (hasAuthGate) {
      if (options.mode === 'review' && options.settings?.execution?.pauseForReviewInHybridMode === true) {
        update('⚠️ Complex / Account portal detected. Contact info pre-filled and tailored CV attached. Pausing for candidate review.');
        return {
          status: 'needs_review',
          message: 'Complex portal pre-filled. Ready for user completion / review.',
          page: page
        };
      } else {
        update('⚠️ External portal requires manual account creation/password login. Saved tailored CV for candidate handoff.');
        return {
          status: 'needs_user_login',
          message: 'External portal requires manual account login/password gate. Tailored CV ready.',
          tailoredCV: tailoredCV?.fileName
        };
      }
    }

    // 4. Autonomous direct submit
    return await this.finalizeExternalSubmission(page, 'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")', update, options);
  }

  /**
   * Helper to answer custom questions on external forms
   */
  async fillStandardQuestions(page, jobInfo, update) {
    try {
      const selects = await page.$$('select');
      for (const sel of selects) {
        if (!(await sel.isVisible())) continue;
        const label = await page.evaluate(el => {
          const l = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
          return l ? l.innerText : '';
        }, sel);

        if (!label) continue;
        const options = await sel.$$eval('option', opts => opts.map(o => o.text.trim()).filter(Boolean));
        const decision = questionEngine.answerQuestion(label, options, 'select', jobInfo);
        if (decision.answer) {
          await sel.selectOption({ label: decision.answer }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  /**
   * Finalize submission: auto-submit directly without requiring approval
   */
  async finalizeExternalSubmission(page, submitSelector, update, options) {
    const isExplicitReview = (options.mode === 'review' || options.settings?.execution?.mode === 'review') &&
                             options.settings?.execution?.pauseForReviewInHybridMode === true;

    if (isExplicitReview) {
      update('Form pre-filled with tailored ATS CV. Pausing for review in Review Mode.');
      return {
        status: 'needs_review',
        message: 'External application filled. Waiting for user review.',
        page: page
      };
    }

    // Autonomous submission: search for submit button and click directly
    let submitBtn = await page.$(submitSelector);
    if (!submitBtn || !(await submitBtn.isVisible())) {
      submitBtn = await page.$(
        'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit application"), button:has-text("Submit"), button:has-text("Send Application"), button:has-text("Complete Application")'
      );
    }

    if (submitBtn && await submitBtn.isVisible()) {
      update('Autonomous Mode: Clicking "Submit Application"...');
      await submitBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(3000, 5000);
      return { status: 'applied', message: 'External application submitted successfully.' };
    }

    return { status: 'applied', message: 'External form filled with tailored CV.' };
  }

  /**
   * Safe typing helper with clear
   */
  async safeType(page, selector, text) {
    if (!text) return;
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        await el.click().catch(() => {});
        await el.fill(text);
        await this.bridge.humanDelay(150, 300);
      }
    } catch (e) {}
  }

  /**
   * Apply directly to an external ATS job URL (Greenhouse, Lever, Ashby, Workday, etc.)
   */
  async applyDirectUrl(page, jobInfo, options = {}) {
    const update = (msg) => {
      if (options.onStatusUpdate) options.onStatusUpdate(msg);
      console.log(`[ExternalApply] ${msg}`);
    };

    // 0. Normalize ATS URL to point directly to application form
    jobInfo.url = this.normalizeAtsUrl(jobInfo.url);
    update(`🌐 Navigating directly to external role: "${jobInfo.title}" at "${jobInfo.company}"...`);
    try {
      await page.goto(jobInfo.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.bridge.humanDelay(2000, 3500);

      const targetUrl = page.url();
      update(`✓ External career page loaded: ${targetUrl.slice(0, 90)}...`);

      // 1. Detect ATS platform & perform early gate check (Fast-Fail before CV generation)
      const platform = await this.detectPlatform(page, targetUrl);
      update(`🔍 Detected Applicant Tracking System (ATS): ${platform.toUpperCase()}`);

      const isAutonomous = options.mode !== 'review' && options.settings?.execution?.pauseForReviewInHybridMode !== true;
      const hasAuthGate = (await page.$('input[type="password"], a:has-text("Create Account"), button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("Log In")')) !== null;
      if (hasAuthGate && isAutonomous) {
        let tailoredCV = null;
        try {
          update(`📄 Pre-generating tailored ATS CV for "${jobInfo.title}" at "${jobInfo.company}"...`);
          tailoredCV = await pdfRenderer.renderTailoredCV(jobInfo);
          jobInfo.tailoredCV = tailoredCV.fileName;
          update(`✓ Synthesized tailored CV for handoff: ${tailoredCV.fileName}`);
        } catch (_) {}

        update(`⚠️ Portal requires manual login account (${jobInfo.company}). Saved tailored CV for candidate handoff.`);
        return {
          status: 'needs_user_login',
          message: 'External portal requires manual account login/password gate. Tailored CV ready.',
          tailoredCV: tailoredCV?.fileName,
          portalUrl: targetUrl
        };
      }

      // 2. Generate tailored ATS vector PDF only for viable applications
      let tailoredCV = null;
      try {
        update(`📄 Generating tailored ATS CV for "${jobInfo.title}" at "${jobInfo.company}"...`);
        tailoredCV = await pdfRenderer.renderTailoredCV(jobInfo);
        jobInfo.tailoredCV = tailoredCV.fileName;
        update(`✓ Synthesized tailored CV: ${tailoredCV.fileName} (${Math.round(tailoredCV.fileSize / 1024)} KB)`);
      } catch (cvErr) {
        update(`⚠️ Tailored CV generation note: ${cvErr.message}`);
      }

      let fillResult = null;
      if (platform === 'greenhouse') {
        fillResult = await this.fillGreenhouse(page, jobInfo, tailoredCV, update, options);
      } else if (platform === 'lever') {
        fillResult = await this.fillLever(page, jobInfo, tailoredCV, update, options);
      } else if (platform === 'ashby') {
        fillResult = await this.fillAshby(page, jobInfo, tailoredCV, update, options);
      } else {
        fillResult = await this.fillGenericOrComplex(page, jobInfo, tailoredCV, update, options);
      }

      return fillResult;
    } catch (err) {
      update(`❌ Error during direct ATS apply: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }
}

module.exports = ExternalApplyEngine;
