const vaultManager = require('../vaultManager');
const path = require('path');
const fs = require('fs');

class OttaEngine {
  constructor(browserBridge, externalApplyEngine) {
    this.bridge = browserBridge;
    this.externalApply = externalApplyEngine;
  }

  /**
   * Verify if the user is authenticated on Otta (Welcome to the Jungle)
   */
  async isLoggedIn(page) {
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('otta.com')) {
        await page.goto('https://app.otta.com/jobs', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.bridge.humanDelay(1500, 2500);
      }

      // Check for user profile, matches, or settings navigation cues
      const userProfile = await page.$(
        'a[href*="/profile"], a[href*="/matches"], a[href*="/applications"], a[href*="/saved"], button[aria-label*="profile"], [data-testid*="user-avatar"], [data-testid*="profile"]'
      );
      if (userProfile) return true;

      const loginBtn = await page.$(
        'a[href*="/login"], a:has-text("Log in"), a:has-text("Sign in"), button:has-text("Log in")'
      );
      if (loginBtn) return false;

      // Check session cookies
      const cookies = await page.context().cookies('https://app.otta.com');
      const hasSession = cookies.some(c => c.name.includes('session') || c.name.includes('auth') || c.name.includes('token') || c.name.includes('user'));
      return hasSession;
    } catch (e) {
      return false;
    }
  }

  /**
   * Search for curated tech & AI scaleup roles on Otta
   */
  
  /**
   * Autonomous login using stored credentials from vault
   */
  async loginWithCredentials(page, creds) {
    if (!creds || !creds.email || !creds.password) return false;
    try {
      await page.goto('https://app.otta.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.bridge.humanDelay(1500, 2500);

      const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email"]');
      if (emailInput) {
        await emailInput.fill(creds.email);
        await this.bridge.humanDelay(500, 1000);
      }

      const passInput = await page.$('input[type="password"], input[name="password"], input[id*="password"]');
      if (passInput) {
        await passInput.fill(creds.password);
        await this.bridge.humanDelay(500, 1000);
      }

      const submitBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
        await this.bridge.humanDelay(2000, 3000);
      }

      return await this.isLoggedIn(page);
    } catch (e) {
      console.warn('[OttaEngine] Auto-login error:', e.message);
      return false;
    }
  }

  async searchJobs(page, keyword, settings, logCallback = () => {}) {
    const cleanK = (keyword || '').trim();
    logCallback(`🚀 [Otta] Searching curated tech scaleup roles for "${cleanK}"...`);

    const searchUrl = `https://app.otta.com/jobs?query=${encodeURIComponent(cleanK)}`;

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.bridge.humanDelay(2000, 3500);

      // Scroll progressively to trigger lazy loading
      for (let s = 0; s < 3; s++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.bridge.humanDelay(800, 1400);
      }

      // Extract listings natively
      let listings = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();
        const candidateLinks = Array.from(document.querySelectorAll('a[href*="/jobs/"], a[href*="/role/"]'));

        for (const link of candidateLinks) {
          const href = link.getAttribute('href') || '';
          if (!href.includes('/jobs/') && !href.includes('/role/')) continue;

          const fullUrl = href.startsWith('http') ? href : `https://app.otta.com${href}`;
          if (seenUrls.has(fullUrl)) continue;

          let rawTitle = link.textContent?.trim() || '';
          if (rawTitle.length < 3) continue;

          const cleanTitle = rawTitle
            .split(/[\n\r]+/)[0]
            .replace(/(?:Remote|Hybrid|Onsite).*$/i, '')
            .replace(/\b(?:NEW|APPLY|TOP MATCH|SALARY)\b/gi, '')
            .trim();

          if (cleanTitle.length < 3) continue;

          // Find company name in container
          let company = 'Tech Scaleup';
          let curr = link.parentElement;
          for (let i = 0; i < 7; i++) {
            if (!curr) break;
            const compEl = curr.querySelector('a[href*="/companies/"], [data-testid*="company"], h3, h4, span.font-bold');
            if (compEl && compEl !== link) {
              const text = compEl.innerText?.trim();
              if (text && text.length > 1 && !text.includes('\n')) {
                company = text.split(/•|Series/i)[0].trim();
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

      logCallback(`✓ Found ${listings.length} scaleup listings on Otta.`);

      return listings.map(item => ({
        jobId: `otta_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        platform: 'otta',
        title: item.title,
        company: item.company,
        location: item.location,
        url: item.url,
        description: `${item.title} at ${item.company} (Curated Otta Tech Scaleup)`
      }));

    } catch (err) {
      logCallback(`⚠️ Otta search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Apply to an Otta job listing:
   * Resolves the direct Ashby/Greenhouse/Lever application URL and applies using ExternalApplyEngine
   */
  async applyJob(page, job, options = {}) {
    const update = options.onStatusUpdate || (() => {});
    update(`🚀 [Otta] Inspecting application path for "${job.title}" at "${job.company}"...`);

    try {
      // 1. If job URL is already a direct ATS URL (Ashby, Greenhouse, Lever, etc.)
      const isDirectAts = /greenhouse\.io|ashbyhq\.com|lever\.co|workable\.com|smartrecruiters\.com/i.test(job.url);
      if (isDirectAts) {
        update(`⚡ Direct ATS URL detected. Delegating directly to ExternalApplyEngine...`);
        return await this.externalApply.applyDirectUrl(page, job, options);
      }

      // 2. Navigate to Otta role detail page to extract outbound apply URL
      if (job.url && !page.url().includes(job.url)) {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(2000, 3000);
      }

      // Check if already applied on Otta page
      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return /already applied|application sent|applied on/i.test(text);
      });
      if (alreadyApplied) {
        return { status: 'previously_applied', message: 'Already applied on Otta.' };
      }

      // Extract full description
      try {
        const fullDesc = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="job-description"], article, main, .description');
          return el ? el.innerText.slice(0, 3000) : '';
        });
        if (fullDesc && fullDesc.length > 60) {
          job.description = fullDesc;
        }
      } catch (_) {}

      // Locate Apply Button on Otta page
      const applyBtn = await page.$(
        'a[href*="greenhouse.io"], a[href*="ashbyhq.com"], a[href*="lever.co"], a[href*="workable.com"], a:has-text("Apply on company website"), a:has-text("Apply externally"), button:has-text("Apply"), a:has-text("Apply")'
      );

      if (!applyBtn) {
        return { status: 'skipped', message: 'No outbound ATS Apply link found on Otta role page.' };
      }

      const href = await applyBtn.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        update(`🔗 Extracted direct company ATS link from Otta: ${href.slice(0, 80)}...`);
        job.url = href;
        return await this.externalApply.applyDirectUrl(page, job, options);
      }

      // If button opens a new tab via click
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
        applyBtn.click({ force: true }).catch(() => {})
      ]);

      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
        const newUrl = newPage.url();
        update(`✓ Captured external ATS tab from Otta: ${newUrl.slice(0, 80)}...`);
        job.url = newUrl;
        const result = await this.externalApply.applyDirectUrl(newPage, job, options);
        await newPage.close().catch(() => {});
        return result;
      }

      return { status: 'skipped', message: 'Could not resolve outbound application destination from Otta.' };

    } catch (err) {
      update(`❌ Otta application error: ${err.message}`);
      return { status: 'failed', message: err.message };
    }
  }
}

module.exports = OttaEngine;
