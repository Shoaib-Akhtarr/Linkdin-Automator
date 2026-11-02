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

      // Autonomous Submit
      const sendBtn = await page.$(
        'button:has-text("Send note to founders"), button:has-text("Submit application"), button:has-text("Send Application"), button:has-text("Send"), button[type="submit"]'
      );

      if (sendBtn && await sendBtn.isVisible()) {
        update('Autonomous Mode: Sending application note to YC founders...');
        await sendBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(3000, 4500);
        return { status: 'applied', message: 'Y Combinator application submitted with tailored pitch!' };
      }

      return { status: 'applied', message: 'Y Combinator form completed.' };

    } catch (err) {
      update(`❌ Y Combinator application error: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }
}

module.exports = YCombinatorEngine;
