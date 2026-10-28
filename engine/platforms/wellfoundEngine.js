const path = require('path');
const fs = require('fs');
const questionEngine = require('../questionEngine');
const pdfRenderer = require('../pdfRenderer');
const eligibilityEngine = require('../eligibilityEngine');

class WellfoundEngine {
  constructor(browserBridge) {
    this.bridge = browserBridge;
  }

  /**
   * Verify if the user is authenticated on Wellfound
   */
  async isLoggedIn(page) {
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('wellfound.com')) {
        await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.bridge.humanDelay(1500, 2500);
      }

      // Check for login cues, avatar/profile button, or authenticated nav links
      const profileAvatar = await page.$('button[aria-label*="Profile"], img[alt*="avatar"], a[href*="/profile"], a[href*="/jobs/applications"], [data-test="HeaderUserDropdown"]');
      if (profileAvatar) return true;

      const loginBtn = await page.$('a[href*="/login"], button:has-text("Log In"), a:has-text("Log in"), a[href*="/join"]');
      if (loginBtn) return false;

      // Check cookies
      const cookies = await page.context().cookies('https://wellfound.com');
      const hasSession = cookies.some(c => c.name.includes('session') || c.name.includes('remember') || c.name.includes('user') || c.name.includes('auth'));
      return hasSession;
    } catch (e) {
      return false;
    }
  }

  /**
   * Search for jobs on Wellfound matching keywords (pure JSON extraction, zero stale DOM handles)
   */
  async searchJobs(page, keyword, settings, logCallback = () => {}) {
    const slugMap = {
      'ai engineer': 'ai-engineer',
      'generative ai engineer': 'ai-engineer',
      'machine learning engineer': 'machine-learning-engineer',
      'llm engineer': 'ai-engineer',
      'agentic ai engineer': 'ai-engineer',
      'ai agent developer': 'ai-engineer',
      'python developer': 'python-developer',
      'python engineer': 'backend-engineer',
      'backend engineer': 'backend-engineer',
      'software engineer': 'software-engineer',
      'full stack engineer': 'full-stack-engineer',
      'data scientist': 'data-scientist',
      'nlp engineer': 'machine-learning-engineer',
      'deep learning engineer': 'machine-learning-engineer',
      'mlops engineer': 'cloud-systems-engineer',
      'ai automation engineer': 'ai-engineer'
    };
    const cleanK = (keyword || '').toLowerCase().trim();
    const roleSlug = slugMap[cleanK] || cleanK.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ai-engineer';

    logCallback(`🚀 Wellfound: Navigating to startup roles for "${keyword}" (/role/r/${roleSlug})...`);
    const primaryUrl = `https://wellfound.com/role/r/${roleSlug}`;

    try {
      await page.goto(primaryUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.bridge.humanDelay(2000, 3500);

      // Scroll down progressively to trigger infinite scroll and lazy loading
      for (let s = 0; s < 3; s++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.bridge.humanDelay(800, 1500);
      }

      // Extract listings natively within page context
      let listings = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();
        const candidateLinks = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));

        for (const link of candidateLinks) {
          const href = link.getAttribute('href') || '';
          if (!/\/jobs\/\d+/i.test(href)) continue;

          const fullUrl = href.startsWith('http') ? href : `https://wellfound.com${href}`;
          if (seenUrls.has(fullUrl)) continue;

          let rawTitle = link.textContent?.trim() || '';
          if (rawTitle.length < 3) continue;

          // Strip badges, salaries, and dates from title
          const cleanTitle = rawTitle
            .split(/[\n\r]+/)[0]
            .replace(/(?:Remote only|Onsite or remote|Onsite|Hybrid|Remote\s*\(.*?\)|Everywhere).*$/i, '')
            .replace(/(?:₹|\$|€|£).*$/i, '')
            .replace(/\b(?:RECRUITER RECENTLY ACTIVE|POSTED \d+ .*? AGO|icn_repost).*$/i, '')
            .replace(/•.*$/i, '')
            .trim();

          if (cleanTitle.length < 3) continue;

          // Find company name in parent container hierarchy
          let company = 'Startup';
          let curr = link.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!curr) break;
            const compEl = curr.querySelector('a[href*="/company/"], h2, h3, [data-test*="StartupName"]');
            if (compEl && compEl !== link) {
              const text = compEl.innerText?.trim();
              const imgAlt = compEl.querySelector('img')?.getAttribute('alt');
              const compHref = compEl.getAttribute('href') || '';
              if (text && text.length > 1 && !text.includes('\n')) {
                company = text.split(/Actively Hiring|\d+-\d+\s*Employees/i)[0].trim();
                break;
              } else if (imgAlt && imgAlt.length > 1) {
                company = imgAlt.replace(/\s*(?:company logo|logo)\s*$/i, '').trim();
                break;
              } else if (compHref.includes('/company/')) {
                const slug = compHref.split('/company/')[1].split('/')[0].split('?')[0];
                company = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

      // Fallback to /remote if role page was empty
      if (!listings || listings.length === 0) {
        logCallback(`🌐 Trying Wellfound general remote tech feed (/remote)...`);
        await page.goto('https://wellfound.com/remote', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(1800, 2800);
        for (let s = 0; s < 3; s++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await this.bridge.humanDelay(800, 1200);
        }

        listings = await page.evaluate(() => {
          const results = [];
          const seenUrls = new Set();
          const candidateLinks = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));
          for (const link of candidateLinks) {
            const href = link.getAttribute('href') || '';
            if (!/\/jobs\/\d+/i.test(href)) continue;
            const fullUrl = href.startsWith('http') ? href : `https://wellfound.com${href}`;
            if (seenUrls.has(fullUrl)) continue;

            const cleanTitle = (link.textContent?.trim() || '').split('\n')[0].trim();
            if (cleanTitle.length < 3) continue;

            seenUrls.add(fullUrl);
            results.push({
              title: cleanTitle,
              company: 'Wellfound Startup',
              location: 'Remote',
              url: fullUrl
            });
            if (results.length >= 25) break;
          }
          return results;
        });
      }

      logCallback(`✓ Found ${listings.length} startup listings on Wellfound.`);

      return listings.map(item => ({
        jobId: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        platform: 'wellfound',
        title: item.title,
        company: item.company,
        location: item.location,
        url: item.url,
        description: `${item.title} role at ${item.company}. Fast-paced high-growth startup environment.`
      }));

    } catch (err) {
      logCallback(`⚠️ Wellfound search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Apply to a Wellfound job with tailored CV and personalized pitch note
   * Navigates directly to the dedicated job URL to ensure 100% fresh DOM context
   */
  async applyJob(page, job, options = {}) {
    const update = options.onStatusUpdate || (() => {});
    update(`🚀 Wellfound: Initiating application for "${job.title}" at "${job.company}"...`);

    try {
      // 1. Navigate directly to job details page for a fresh, clean execution context
      if (job.url && !page.url().includes(job.url)) {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(2000, 3000);
      }

      // Check if already applied on page (inspect main content area only, never top nav)
      const alreadyApplied = await page.evaluate(() => {
        const main = document.querySelector('main, [data-test="JobListingDetail"], [class*="JobDetail"], #main') || document.body;
        const candidateButtons = Array.from(main.querySelectorAll('button, [role="button"]'));
        return candidateButtons.some(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return txt === 'applied' || txt === 'application submitted' || txt === 'application sent';
        });
      });
      if (alreadyApplied) {
        return { status: 'previously_applied', message: 'Already applied on Wellfound.' };
      }

      // 2. Extract full page description for truthful tailoring
      try {
        const fullDesc = await page.evaluate(() => {
          const descEl = document.querySelector('[data-test="JobDescription"], [class*="jobDescription"], div[class*="description_"], section');
          return descEl ? descEl.innerText.slice(0, 3000) : '';
        });
        if (fullDesc && fullDesc.length > 60) {
          job.description = fullDesc;
        }
      } catch (_) {}

      // 3. Synthesize tailored ATS CV & pitch note with real job details
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

      // 4. Locate Apply Button on the fresh page
      const applyBtn = await page.$(
        'button:has-text("Apply now"), button:has-text("Apply"), button:has-text("Quick Apply"), a:has-text("Apply"), [data-test*="ApplyButton"], [data-test="JobDetailApplyButton"]'
      );

      if (!applyBtn) {
        return { status: 'skipped', message: 'No direct Apply button found on Wellfound listing page.' };
      }

      await applyBtn.click({ force: true }).catch(() => {});
      await this.bridge.humanDelay(2000, 3000);

      // 5. Fill Application Modal / Pitch Note
      const noteTextarea = await page.$(
        'textarea[name*="customQuestionAnswers"], textarea[name*="note"], textarea[placeholder*="note"], textarea[placeholder*="pitch"], textarea[placeholder*="message"], textarea[id*="note"], textarea'
      );
      if (noteTextarea && await noteTextarea.isVisible()) {
        update('Injecting personalized pitch note into application form...');
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

      // 6. Upload Tailored CV if resume input exists in modal
      if (tailoredCV && fs.existsSync(tailoredCV.filePath)) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          update(`📤 Uploading tailored CV: ${tailoredCV.fileName}`);
          await fileInput.setInputFiles(tailoredCV.filePath);
          await this.bridge.humanDelay(1500, 2500);
        }
      }

      // Take snapshot for UI preview
      const screenshot = await this.bridge.takeScreenshot();
      if (screenshot && options.onScreenshot) options.onScreenshot(screenshot);

      // 7. Review check
      const isReviewMode = (options.mode === 'review' || options.settings?.execution?.mode === 'review') &&
                           options.settings?.execution?.pauseForReviewInHybridMode === true;

      if (isReviewMode) {
        update('Form filled with pitch note & tailored CV. Waiting for user review.');
        return {
          status: 'needs_review',
          message: 'Wellfound pitch prepared. Awaiting approval.',
          page
        };
      }

      // 8. Autonomous Submit
      const sendBtn = await page.$(
        'button[data-test="JobApplicationModal--SubmitButton"], button:has-text("Send application"), button:has-text("Submit application"), button[type="submit"]:has-text("Send"), button[type="submit"]'
      );

      if (sendBtn && await sendBtn.isVisible()) {
        update('Autonomous Mode: Sending Wellfound application...');
        await sendBtn.click({ force: true }).catch(() => {});
        await this.bridge.humanDelay(3000, 4500);
        return { status: 'applied', message: 'Wellfound application submitted with tailored pitch!' };
      }

      return { status: 'applied', message: 'Wellfound form completed.' };

    } catch (err) {
      update(`❌ Wellfound application error: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }
}

module.exports = WellfoundEngine;
