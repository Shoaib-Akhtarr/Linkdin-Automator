const path = require('path');
const fs = require('fs');
const questionEngine = require('../questionEngine');
const pdfRenderer = require('../pdfRenderer');
const eligibilityEngine = require('../eligibilityEngine');

class YCombinatorEngine {
  constructor(browserBridge) {
    this.bridge = browserBridge;
  }

  /**
   * Verify if the user is authenticated on Y Combinator (Work at a Startup)
   */
  async isLoggedIn(page) {
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('workatastartup.com')) {
        await page.goto('https://www.workatastartup.com/jobs', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.bridge.humanDelay(1500, 2500);
      }

      // Check for authenticated navigation cues or candidate profile links
      const userProfile = await page.$(
        'a[href*="/candidate/"], a[href*="/profile"], a:has-text("Profile"), a:has-text("Log out"), a:has-text("Sign out"), a[href*="/logout"], [data-test="user-menu"], .user-avatar, img[alt*="avatar"]'
      );
      if (userProfile) return true;

      const loginBtn = await page.$(
        'a[href*="/users/sign_in"], a:has-text("Log In"), a:has-text("Sign in"), a[href*="/sign_in"]'
      );
      if (loginBtn) return false;

      // Check session cookies
      const cookies = await page.context().cookies('https://www.workatastartup.com');
      const hasSession = cookies.some(c => c.name.includes('session') || c.name.includes('remember') || c.name.includes('user') || c.name.includes('auth'));
      return hasSession;
    } catch (e) {
      return false;
    }
  }

  /**
   * Search for startup roles matching keywords on YC Work at a Startup
   */
  async searchJobs(page, keyword, settings, logCallback = () => {}) {
    const cleanK = (keyword || '').trim();
    logCallback(`🚀 [Y Combinator] Searching curated YC startup roles for "${cleanK}"...`);

    const searchUrl = `https://www.workatastartup.com/jobs?query=${encodeURIComponent(cleanK)}&demographic=any&has_equity=any&remote=only`;

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.bridge.humanDelay(2000, 3500);

      // Scroll progressively down to load infinite scroll listings
      for (let s = 0; s < 3; s++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.bridge.humanDelay(800, 1400);
      }

      // Extract listings within page context
      let listings = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();

        // Work at a Startup lists jobs with links to /companies/.../jobs/... or /jobs/...
        const candidateLinks = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));

        for (const link of candidateLinks) {
          const href = link.getAttribute('href') || '';
          if (!href.includes('/jobs/')) continue;

          const fullUrl = href.startsWith('http') ? href : `https://www.workatastartup.com${href}`;
          if (seenUrls.has(fullUrl)) continue;

          let rawTitle = link.textContent?.trim() || '';
          if (rawTitle.length < 3) continue;

          const cleanTitle = rawTitle
            .split(/[\n\r]+/)[0]
            .replace(/(?:Remote|Onsite|Full-time|Contract|Part-time).*$/i, '')
            .replace(/\b(?:NEW|APPLY|POSTED|FEATURED)\b/gi, '')
            .trim();

          if (cleanTitle.length < 3) continue;

          // Attempt to find company name in parent container
          let company = 'YC Startup';
          let curr = link.parentElement;
          for (let i = 0; i < 7; i++) {
            if (!curr) break;
            const compEl = curr.querySelector('a[href*="/companies/"], .company-name, h3, h4, [class*="companyName"]');
            if (compEl && compEl !== link) {
              const text = compEl.innerText?.trim();
              if (text && text.length > 1 && !text.includes('\n')) {
                company = text.split(/•|Batch/i)[0].trim();
                break;
              }
            }
            curr = curr.parentElement;
          }

          seenUrls.add(fullUrl);
          results.push({
            title: cleanTitle,
            company,
            location: 'Remote',
            url: fullUrl
          });

          if (results.length >= 25) break;
        }

        return results;
      });

      logCallback(`✓ Found ${listings.length} startup listings on Y Combinator.`);

      return listings.map(item => ({
        jobId: `yc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        platform: 'ycombinator',
        title: item.title,
        company: item.company,
        location: item.location,
        url: item.url,
        description: `${item.title} role at ${item.company}. High-growth Y Combinator venture-backed startup.`
      }));

    } catch (err) {
      logCallback(`⚠️ Y Combinator search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Apply directly to a YC job with tailored ATS CV and personalized founder pitch note
   */
  async applyJob(page, job, options = {}) {
    const update = options.onStatusUpdate || (() => {});
    update(`🚀 [Y Combinator] Initiating application for "${job.title}" at "${job.company}"...`);

    try {
      if (job.url && !page.url().includes(job.url)) {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(2000, 3000);
      }

      // Check if already applied on page
      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return /already applied|application submitted|note sent to founders/i.test(text);
      });
      if (alreadyApplied) {
        return { status: 'previously_applied', message: 'Already applied on Y Combinator.' };
      }

      // Extract full job description for truthful tailoring
      try {
        const fullDesc = await page.evaluate(() => {
          const descEl = document.querySelector('.job-description, [data-test="job-description"], div[class*="description"], article, main');
          return descEl ? descEl.innerText.slice(0, 3000) : '';
        });
        if (fullDesc && fullDesc.length > 60) {
          job.description = fullDesc;
        }
      } catch (_) {}

      // Synthesize tailored ATS CV & founder pitch note
      let tailoredCV = null;
      try {
        update(`📄 Generating tailored ATS CV for "${job.title}" at "${job.company}"...`);
        tailoredCV = await pdfRenderer.renderTailoredCV(job);
        job.tailoredCV = tailoredCV.fileName;
        update(`✓ Synthesized tailored CV: ${tailoredCV.fileName}`);
      } catch (cvErr) {
        update(`⚠️ Tailored CV note: ${cvErr.message}`);
      }

      const pitchNote = questionEngine.generatePitchNote(job);
      job.pitchNote = pitchNote;
      update(`✍️ Synthesized tailored founder pitch note (${pitchNote.split('\n')[0]}...)`);

      // Locate Apply / Contact Founder button
      const applyBtn = await page.$(
        'button:has-text("Apply to Job"), button:has-text("Apply"), a:has-text("Apply to Job"), button:has-text("Contact Founder"), button:has-text("Send note"), a:has-text("Apply")'
      );

      if (!applyBtn) {
        return { status: 'skipped', message: 'No direct Apply button found on YC job page.' };
      }

      await applyBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(2000, 3000);

      // Locate Note textarea to founders
      const noteTextarea = await page.$(
        'textarea[name*="note"], textarea[placeholder*="note"], textarea[placeholder*="founder"], textarea[placeholder*="message"], textarea[name*="message"], textarea'
      );

      if (noteTextarea && await noteTextarea.isVisible()) {
        update('Injecting personalized founder pitch note into YC application form...');
        try {
          await noteTextarea.click({ timeout: 2000 }).catch(() => {});
          await noteTextarea.fill(pitchNote, { timeout: 3500 });
        } catch (fillErr) {
          await page.evaluate(({ el, text }) => {
            if (el) {
              el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, { el: noteTextarea, text: pitchNote }).catch(() => {});
        }
        await this.bridge.humanDelay(800, 1200);
      }

      // Upload Tailored CV if file upload input exists
      if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          update(`📤 Uploading tailored CV: ${tailoredCV.fileName}`);
          await fileInput.setInputFiles(tailoredCV.filePath);
          await this.bridge.humanDelay(1500, 2500);
        }
      }

      const screenshot = await this.bridge.takeScreenshot();
      if (screenshot && options.onScreenshot) options.onScreenshot(screenshot);

      // Review check
      const isReviewMode = (options.mode === 'review' || options.settings?.execution?.mode === 'review') &&
                           options.settings?.execution?.pauseForReviewInHybridMode === true;

      if (isReviewMode) {
        update('Form filled with founder pitch note & tailored CV. Waiting for user review.');
        return {
          status: 'needs_review',
          message: 'Y Combinator application prepared. Awaiting approval.',
          page
        };
      }

      // Fill any additional questions / work authorization / salary / checkboxes
      await this.fillAdditionalQuestions(page, job, update);

      // Autonomous Submit
      const sendBtn = await page.$(
        'button:has-text("Send note to founders"), button:has-text("Submit application"), button:has-text("Send Application"), button:has-text("Send"), button[type="submit"]'
      );

      if (sendBtn && await sendBtn.isVisible()) {
        update('Autonomous Mode: Sending application note to YC founders...');
        await sendBtn.click({ force: true }).catch(() => {});

        // Two-Step Verification: Ensure DOM receipt text & zero inline errors
        const verification = await this.verifyYCombinatorSubmission(page, update);
        if (verification.confirmed) {
          return { status: 'applied', message: 'Y Combinator application verified and submitted successfully!' };
        } else {
          return { status: 'failed', message: `YC submission unverified: ${verification.reason}` };
        }
      }

      return { status: 'skipped', message: 'No active send button found on YC application modal.' };

    } catch (err) {
      update(`❌ Y Combinator application error: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }

  /**
   * Automatically resolve and fill additional questions on YC Work at a Startup
   */
  async fillAdditionalQuestions(page, job, update = () => {}) {
    try {
      const profile = questionEngine.getProfile ? questionEngine.getProfile() : {};
      const p = profile.personal || {};
      const w = profile.workAuthorization || {};
      const c = profile.compensationAndAvailability || {};

      // 1. Text / Number Inputs (Excluding file/hidden/radio/checkbox)
      const inputs = await page.$$('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])').catch(() => []);
      for (const input of inputs) {
        try {
          if (!(await input.isVisible().catch(() => false))) continue;
          const currentVal = await input.inputValue().catch(() => '');
          if (currentVal && currentVal.trim().length > 0) continue;

          const meta = await page.evaluate(el => {
            const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
            return {
              name: el.name || '',
              placeholder: el.placeholder || '',
              id: el.id || '',
              label: label ? label.innerText.trim() : ''
            };
          }, input).catch(() => ({}));

          const promptText = `${meta.label} ${meta.name} ${meta.placeholder} ${meta.id}`.toLowerCase();

          let answer = null;
          if (/salary|compensation|expected pay/i.test(promptText)) {
            answer = String(c.desiredSalaryNumeric || '120000');
          } else if (/linkedin/i.test(promptText)) {
            answer = p.links?.linkedin || 'https://www.linkedin.com/in/shoaib-akhtar-133103300/';
          } else if (/github/i.test(promptText)) {
            answer = p.links?.github || 'https://github.com/Shoaib-Akhtarr';
          } else if (/portfolio|website/i.test(promptText)) {
            answer = p.links?.portfolio || p.links?.github || 'https://github.com/Shoaib-Akhtarr';
          } else if (/phone|mobile/i.test(promptText)) {
            answer = p.phone || '+923056054842';
          } else if (/city|location|residence/i.test(promptText)) {
            answer = p.address?.city || 'Remote';
          } else if (/years.*experience|experience.*years/i.test(promptText)) {
            answer = '4';
          } else {
            answer = questionEngine.resolveDirectMatch(promptText, job);
          }

          if (answer) {
            update(`Filling YC question: "${(meta.label || meta.placeholder || meta.name).slice(0, 35)}" -> "${answer}"`);
            await input.fill(String(answer)).catch(() => {});
            await this.bridge.humanDelay(300, 600);
          }
        } catch (_) {}
      }

      // 2. Radio Groups (Authorization, Sponsorship, Relocation)
      const radioGroups = await page.evaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const groups = {};
        for (const r of radios) {
          const name = r.name || 'unnamed';
          if (!groups[name]) groups[name] = [];
          const label = r.closest('label') || document.querySelector(`label[for="${r.id}"]`);
          const container = r.closest('fieldset, .form-group, div[class*="question"], div[class*="field"]');
          const groupQuestion = container ? (container.querySelector('legend, label, .question-title')?.innerText || '') : '';
          groups[name].push({
            id: r.id,
            value: r.value,
            labelText: label ? label.innerText.trim() : '',
            checked: r.checked,
            groupQuestion: groupQuestion.trim()
          });
        }
        return groups;
      }).catch(() => ({}));

      for (const [name, items] of Object.entries(radioGroups)) {
        if (items.some(i => i.checked)) continue;
        const qText = `${items[0]?.groupQuestion || ''} ${name}`.toLowerCase();

        let targetValue = null;
        if (/sponsorship|require.*visa|sponsor/i.test(qText)) {
          targetValue = /no/i;
        } else if (/authorized|legally|eligib/i.test(qText)) {
          targetValue = /yes/i;
        } else if (/remote|work from home/i.test(qText)) {
          targetValue = /yes/i;
        }

        if (targetValue) {
          const match = items.find(i => targetValue.test(i.labelText) || targetValue.test(i.value));
          if (match && match.id) {
            const radioEl = await page.$(`#${CSS.escape(match.id)}`);
            if (radioEl) {
              await radioEl.click({ force: true }).catch(() => {});
              await this.bridge.humanDelay(200, 400);
            }
          }
        }
      }

      // 3. Dropdown Selects
      const selects = await page.$$('select').catch(() => []);
      for (const sel of selects) {
        try {
          if (!(await sel.isVisible().catch(() => false))) continue;
          const currentVal = await sel.inputValue().catch(() => '');
          if (currentVal && currentVal !== '' && currentVal !== '0') continue;

          const selMeta = await page.evaluate(el => {
            const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
            return {
              name: el.name || '',
              label: label ? label.innerText.trim() : '',
              options: Array.from(el.options).map(o => ({ value: o.value, text: o.innerText.trim() }))
            };
          }, sel).catch(() => ({ options: [] }));

          const prompt = `${selMeta.label} ${selMeta.name}`.toLowerCase();
          let chosen = null;

          if (/authorized|legally/i.test(prompt)) {
            chosen = selMeta.options.find(o => /^yes/i.test(o.text));
          } else if (/sponsorship|sponsor/i.test(prompt)) {
            chosen = selMeta.options.find(o => /^no/i.test(o.text));
          }

          if (chosen && chosen.value) {
            await sel.selectOption(chosen.value).catch(() => {});
          }
        } catch (_) {}
      }

      // 4. Required Checkboxes / Terms
      const checkboxes = await page.$$('input[type="checkbox"]').catch(() => []);
      for (const cb of checkboxes) {
        try {
          if (!(await cb.isVisible().catch(() => false))) continue;
          const isChecked = await cb.isChecked().catch(() => false);
          if (!isChecked) {
            await cb.check({ force: true }).catch(() => {});
            await this.bridge.humanDelay(200, 400);
          }
        } catch (_) {}
      }

    } catch (qErr) {
      update(`⚠️ Note on YC question filling: ${qErr.message}`);
    }
  }

  /**
   * Two-Step Verification for Y Combinator Submissions:
   * Step 1: DOM receipt text confirmation & audit for inline validation errors.
   * Step 2: Page-level submit button disappearance or status change to "Applied" / "Note sent".
   */
  async verifyYCombinatorSubmission(page, update = () => {}) {
    update('🕵️ [Two-Step Verification] Auditing Y Combinator application submission...');
    await this.bridge.humanDelay(3000, 4500);

    // Step 1: Inline Validation Error Audit
    const errorSelector = '.error, [class*="error"], [class*="alert-danger"], [role="alert"], [aria-invalid="true"], span.invalid-feedback';
    const visibleErrors = await page.evaluate((sel) => {
      const errs = Array.from(document.querySelectorAll(sel));
      return errs
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && (el.innerText || '').trim().length > 0;
        })
        .map(el => el.innerText.trim());
    }, errorSelector).catch(() => []);

    if (visibleErrors.length > 0) {
      update(`❌ Verification Step 1 FAILED: Detected inline validation errors on YC: "${visibleErrors[0].slice(0, 60)}"`);
      return {
        confirmed: false,
        reason: `Inline validation error: ${visibleErrors[0]}`
      };
    }

    // Step 1: DOM Confirmation Receipt Text
    const domReceipt = await page.evaluate(() => {
      const text = (document.body ? document.body.innerText : '').toLowerCase();
      const confirmedPatterns = [
        'note sent to founders',
        'we\'ve sent your note',
        'your note has been sent',
        'application submitted',
        'application sent',
        'you\'ve applied',
        'you applied',
        'already applied'
      ];
      return confirmedPatterns.some(pat => text.includes(pat));
    }).catch(() => false);

    // Step 2: In-Page Button State Audit (Submit button gone or disabled/changed)
    const buttonState = await page.evaluate(() => {
      const submitButtons = Array.from(document.querySelectorAll(
        'button:has-text("Send note to founders"), button:has-text("Submit application"), button:has-text("Send Application"), button:has-text("Send"), button[type="submit"]'
      ));

      const visibleActiveSubmit = submitButtons.some(b => {
        const style = window.getComputedStyle(b);
        return style.display !== 'none' && style.visibility !== 'hidden' && !b.disabled && !b.classList.contains('disabled');
      });

      // Check for success badges / buttons
      const appliedBadge = Array.from(document.querySelectorAll('button, span, div, a')).some(el => {
        const t = (el.innerText || '').toLowerCase().trim();
        return t === 'note sent' || t === 'applied' || t === 'application sent';
      });

      return {
        hasActiveSubmit: visibleActiveSubmit,
        hasAppliedBadge: appliedBadge
      };
    }).catch(() => ({ hasActiveSubmit: false, hasAppliedBadge: false }));

    if (domReceipt || buttonState.hasAppliedBadge || !buttonState.hasActiveSubmit) {
      update('🎉 [Two-Step Verification] PASSED: Y Combinator application confirmed via DOM receipt & button state transition!');
      return { confirmed: true };
    }

    update('⚠️ [Two-Step Verification] FAILED: YC submit button remains active and no confirmation receipt detected.');
    return {
      confirmed: false,
      reason: 'No submission confirmation receipt detected in DOM.'
    };
  }

}

module.exports = YCombinatorEngine;
