/**
 * Venture Capital Portfolio Careers Engine (a16z & Sequoia Capital)
 * Direct access to top venture-backed portfolio company job openings.
 */

'use strict';

const tracker = require('../tracker');
const eligibilityEngine = require('../eligibilityEngine');

class VcPortfolioEngine {
  constructor(browserBridge, externalApplyEngine) {
    this.bridge = browserBridge;
    this.externalApply = externalApplyEngine;
  }

  log(cb, msg) {
    if (typeof cb === 'function') cb(msg);
    console.log(`[VcPortfolioEngine] ${msg}`);
  }

  /**
   * Search a16z Portfolio Jobs (jobs.a16z.com)
   */
  async searchA16z(page, keyword, settings, logCallback = () => {}) {
    const cleanK = (keyword || 'AI Engineer').trim();
    this.log(logCallback, `🌐 [a16z Portfolio] Searching venture-backed roles for "${cleanK}"...`);
    const searchUrl = `https://jobs.a16z.com/jobs?query=${encodeURIComponent(cleanK)}&remote=true`;

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.bridge.humanDelay(2000, 3000);

      // Scroll down to load results
      for (let s = 0; s < 2; s++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.bridge.humanDelay(600, 1000);
      }

      const listings = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();
        const cards = document.querySelectorAll('[data-test="job-card"], .job-card, a[href*="/jobs/"]');

        for (const card of cards) {
          const link = card.tagName.toLowerCase() === 'a' ? card : card.querySelector('a[href*="/jobs/"]');
          if (!link) continue;
          const href = link.href;
          if (!href || seenUrls.has(href)) continue;

          const title = (card.querySelector('h2, h3, .job-title, [class*="title"]') || link).innerText.trim().split('\n')[0];
          const companyEl = card.querySelector('.company-name, [class*="company"], h4');
          const company = companyEl ? companyEl.innerText.trim().split('\n')[0] : 'a16z Portfolio Company';
          const locEl = card.querySelector('.location, [class*="location"]');
          const location = locEl ? locEl.innerText.trim() : 'Remote';

          if (title.length > 3) {
            seenUrls.add(href);
            results.push({
              title,
              company,
              location,
              url: href,
              platform: 'a16z',
              source: `a16z Portfolio (${company})`
            });
          }
        }
        return results;
      });

      this.log(logCallback, `✓ [a16z Portfolio] Found ${listings.length} candidate role(s).`);
      return listings;
    } catch (err) {
      this.log(logCallback, `⚠️ [a16z Portfolio] Search note: ${err.message}`);
      return [];
    }
  }

  /**
   * Search Sequoia Capital Portfolio Jobs (jobs.sequoiacap.com)
   */
  async searchSequoia(page, keyword, settings, logCallback = () => {}) {
    const cleanK = (keyword || 'AI Engineer').trim();
    this.log(logCallback, `🌲 [Sequoia Portfolio] Searching portfolio roles for "${cleanK}"...`);
    const searchUrl = `https://jobs.sequoiacap.com/jobs?query=${encodeURIComponent(cleanK)}&remote=true`;

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.bridge.humanDelay(2000, 3000);

      for (let s = 0; s < 2; s++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.bridge.humanDelay(600, 1000);
      }

      const listings = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();
        const cards = document.querySelectorAll('[data-test="job-card"], .job-card, a[href*="/jobs/"]');

        for (const card of cards) {
          const link = card.tagName.toLowerCase() === 'a' ? card : card.querySelector('a[href*="/jobs/"]');
          if (!link) continue;
          const href = link.href;
          if (!href || seenUrls.has(href)) continue;

          const title = (card.querySelector('h2, h3, .job-title, [class*="title"]') || link).innerText.trim().split('\n')[0];
          const companyEl = card.querySelector('.company-name, [class*="company"], h4');
          const company = companyEl ? companyEl.innerText.trim().split('\n')[0] : 'Sequoia Portfolio Company';
          const locEl = card.querySelector('.location, [class*="location"]');
          const location = locEl ? locEl.innerText.trim() : 'Remote';

          if (title.length > 3) {
            seenUrls.add(href);
            results.push({
              title,
              company,
              location,
              url: href,
              platform: 'sequoia',
              source: `Sequoia Portfolio (${company})`
            });
          }
        }
        return results;
      });

      this.log(logCallback, `✓ [Sequoia Portfolio] Found ${listings.length} candidate role(s).`);
      return listings;
    } catch (err) {
      this.log(logCallback, `⚠️ [Sequoia Portfolio] Search note: ${err.message}`);
      return [];
    }
  }

  /**
   * Unified VC Search runner
   */
  async searchAllVcJobs(page, keyword, settings, logCallback = () => {}) {
    const a16zJobs = await this.searchA16z(page, keyword, settings, logCallback);
    const sequoiaJobs = await this.searchSequoia(page, keyword, settings, logCallback);
    return [...a16zJobs, ...sequoiaJobs];
  }
}

module.exports = VcPortfolioEngine;
