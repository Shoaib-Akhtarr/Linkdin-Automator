const tracker = require('./tracker');

class SearchEngine {
  constructor(browserBridge) {
    this.bridge = browserBridge;
  }

  /**
   * Build the LinkedIn job search URL based on settings
   */
  buildSearchUrl(keyword, settings, start = 0) {
    const searchConfig = settings.search || {};
    const params = new URLSearchParams();

    params.set('keywords', keyword || 'AI Engineer');

    if (start > 0) {
      params.set('start', String(start));
    }

    // Handle Location & Workplace type safely with geoId mapping
    const loc = (searchConfig.location || '').trim();
    if (loc && loc.toLowerCase() !== 'remote' && loc.toLowerCase() !== 'anywhere') {
      params.set('location', loc);

      const geoMap = {
        'united states': '103644278',
        'us': '103644278',
        'usa': '103644278',
        'pakistan': '101022442',
        'india': '102713980',
        'united kingdom': '101165590',
        'uk': '101165590',
        'canada': '101174742',
        'europe': '100565514',
        'germany': '101282230',
        'australia': '101452733',
        'united arab emirates': '104305776',
        'uae': '104305776',
        'dubai': '103856277',
        'worldwide': '92000000'
      };
      const cleanLoc = loc.toLowerCase().trim();
      if (geoMap[cleanLoc]) {
        params.set('geoId', geoMap[cleanLoc]);
      }
    }

    // Easy Apply filter: Only add f_AL=true if explicitly restricted to Easy Apply
    const isEasyApplyOnly = searchConfig.easyApplyOnly === true || searchConfig.applyType === 'easy_apply';
    if (isEasyApplyOnly) {
      params.set('f_AL', 'true');
    }

    // Workplace type (Remote = 2, On-site = 1, Hybrid = 3)
    if (searchConfig.workplaceType === 'remote' || (searchConfig.remoteOnly && !searchConfig.workplaceType)) {
      params.set('f_WT', '2');
    } else if (searchConfig.workplaceType === 'hybrid') {
      params.set('f_WT', '3');
    } else if (searchConfig.workplaceType === 'onsite') {
      params.set('f_WT', '1');
    }

    // Date posted filter
    if (searchConfig.datePosted === 'past24h') {
      params.set('f_TPR', 'r86400');
    } else if (searchConfig.datePosted === 'pastWeek') {
      params.set('f_TPR', 'r604800');
    } else if (searchConfig.datePosted === 'pastMonth') {
      params.set('f_TPR', 'r2592000');
    }

    // Experience levels (only apply if specified and not empty)
    const expMap = {
      'internship': '1',
      'entry level': '2',
      'associate': '3',
      'mid-senior level': '4',
      'director': '5'
    };
    if (Array.isArray(searchConfig.experienceLevels) && searchConfig.experienceLevels.length > 0) {
      const expValues = searchConfig.experienceLevels
        .map(lvl => expMap[lvl.toLowerCase()])
        .filter(Boolean);
      if (expValues.length > 0) {
        params.set('f_E', expValues.join(','));
      }
    }

    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  }

  /**
   * Navigate to search results and extract available jobs (with pagination)
   */
  async navigateToSearch(keyword, settings, update) {
    const page = await this.bridge.getPage();
    const maxPages = settings.search?.paginationPages || 3;
    const allJobs = [];
    const seenJobIds = new Set();

    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const url = this.buildSearchUrl(keyword, settings, pageNum * 25);
      update(`Navigating to search URL (page ${pageNum + 1}): ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        update(`Navigation note: ${e.message}`);
      }

      await this.bridge.humanDelay(2500, 4000);
      await this.scrollJobList(page);
      const pageJobs = await this.extractJobListings(page, settings, update);

      // Deduplicate across pages (by ID and Company+Title)
      const newJobs = pageJobs.filter(j => {
        if (seenJobIds.has(j.jobId)) return false;
        if (allJobs.some(existing => tracker.isSameJob(existing, j))) return false;
        return true;
      });
      newJobs.forEach(j => seenJobIds.add(j.jobId));
      allJobs.push(...newJobs);

      if (pageJobs.length < 5) break; // No more results
    }

    update(`Found ${allJobs.length} candidate Easy Apply listings for "${keyword}" (across ${maxPages} pages).`);
    return allJobs;
  }

  /**
   * Scroll down the job listing panel
   */
  async scrollJobList(page) {
    try {
      // Try scrolling LazyColumn or window
      await page.evaluate(() => {
        const col = document.querySelector('[data-testid="lazy-column"], [data-component-type="LazyColumn"], .jobs-search-results-list');
        if (col) {
          col.scrollBy(0, 1000);
        } else {
          window.scrollBy(0, 1000);
        }
      });
      await this.bridge.humanDelay(1000, 2000);

      await page.evaluate(() => {
        const col = document.querySelector('[data-testid="lazy-column"], [data-component-type="LazyColumn"], .jobs-search-results-list');
        if (col) {
          col.scrollBy(0, 1500);
        } else {
          window.scrollBy(0, 1500);
        }
      });
      await this.bridge.humanDelay(800, 1500);
    } catch (e) {}
  }

  /**
   * Extract all job items visible on the current page
   * Supports both new React LazyColumn UI and classic HTML layouts
   */
  async extractJobListings(page, settings, update) {
    const blacklist = (settings.search?.blacklistCompanies || []).map(b => b.toLowerCase());

    const jobs = await page.evaluate(() => {
      const results = [];

      const extractNumericIdFromText = (txt) => {
        if (!txt) return null;
        const m = txt.match(/(\d{7,14})/);
        return m ? m[1] : null;
      };

      // Strategy A: Modern React UI with LazyColumn
      const lazyColumn = document.querySelector('[data-testid="lazy-column"], [data-component-type="LazyColumn"]');
      if (lazyColumn) {
        const cards = Array.from(lazyColumn.querySelectorAll('div[role="button"]'));
        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const text = (card.innerText || '').trim();
          if (!text || text.includes('Privacy & Terms') || text.includes('Business Services')) continue;

          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length < 2) continue;

          // Lines typically: [0] Title, [1] Title or Company, [2] Company or Location
          let title = lines[0].replace(/^Selected,\s*/i, '');
          let company = lines[1] || 'Unknown Company';
          if (lines[0] === lines[1] && lines[2]) {
            company = lines[2];
          }

          let location = lines[2] || lines[3] || '';

          // 1. Extract Real Numeric Job ID from all available anchors and attributes
          let jobId = '';
          const rawJobId = card.getAttribute('data-job-id') ||
                           card.getAttribute('data-occludable-job-id') ||
                           card.querySelector('[data-job-id]')?.getAttribute('data-job-id') ||
                           card.querySelector('[data-occludable-job-id]')?.getAttribute('data-occludable-job-id');
          if (rawJobId && /^\d+$/.test(rawJobId)) {
            jobId = rawJobId;
          }

          if (!jobId) {
            const links = Array.from(card.querySelectorAll('a[href]'));
            for (const a of links) {
              const href = a.href || '';
              const m1 = href.match(/\/jobs\/view\/(\d+)/);
              if (m1) { jobId = m1[1]; break; }
              const m2 = href.match(/[?&]currentJobId=(\d+)/);
              if (m2) { jobId = m2[1]; break; }
              const m3 = href.match(/[?&]jobId=(\d+)/);
              if (m3) { jobId = m3[1]; break; }
            }
          }

          if (!jobId) {
            const urnMatch = (card.outerHTML || '').match(/urn:li:(?:fsd_)?jobPosting:(\d+)/);
            if (urnMatch) jobId = urnMatch[1];
          }

          // Deterministic fallback (Never use index i!)
          if (!jobId) {
            const cleanC = company.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
            const cleanT = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
            jobId = `hash_${cleanC}_${cleanT}`;
          }

          // 2. Detect if LinkedIn search card shows "Applied" badge or status
          let isAppliedOnLinkedIn = false;
          const nonTitleLines = lines.filter(l => l.toLowerCase() !== title.toLowerCase());
          for (const line of nonTitleLines) {
            const l = line.trim().toLowerCase();
            if (
              l === 'applied' ||
              l === 'application submitted' ||
              /^applied\s*[·•-]\s*easy apply/i.test(l) ||
              /^applied\s+\d+[mhdwy]\s+ago/i.test(l) ||
              /^applied\s+on\s+/i.test(l) ||
              /^applied\s+(today|yesterday)/i.test(l)
            ) {
              isAppliedOnLinkedIn = true;
              break;
            }
          }

          if (!isAppliedOnLinkedIn) {
            const appliedBadge = card.querySelector(
              '.job-card-container__footer-item--highlighted, [class*="applied-date"], [class*="application-date"], .artdeco-inline-feedback--success, [aria-label*="Applied"]'
            );
            if (appliedBadge) {
              const bText = (appliedBadge.innerText || appliedBadge.getAttribute('aria-label') || '').toLowerCase();
              if (bText.includes('applied')) {
                isAppliedOnLinkedIn = true;
              }
            }
          }

          const hasEasyApply = text.toLowerCase().includes('easy apply');

          results.push({
            index: i,
            jobId: String(jobId),
            title,
            company,
            location,
            hasEasyApply,
            isAppliedOnLinkedIn
          });
        }

        if (results.length > 0) return results;
      }

      // Strategy B: Classic LinkedIn layout
      const classicCards = Array.from(
        document.querySelectorAll('li[data-occludable-job-id], div.job-card-container, div[data-job-id]')
      );
      for (let i = 0; i < classicCards.length; i++) {
        const card = classicCards[i];
        let jobId =
          card.getAttribute('data-occludable-job-id') ||
          card.getAttribute('data-job-id') ||
          card.querySelector('[data-job-id]')?.getAttribute('data-job-id');

        if (!jobId || !/^\d+$/.test(jobId)) {
          const links = Array.from(card.querySelectorAll('a[href]'));
          for (const a of links) {
            const href = a.href || '';
            const m = href.match(/\/jobs\/view\/(\d+)/) || href.match(/[?&]currentJobId=(\d+)/);
            if (m) { jobId = m[1]; break; }
          }
        }

        const titleEl = card.querySelector(
          '.job-card-list__title, a.job-card-container__link, strong'
        );
        const title = titleEl ? titleEl.innerText.trim() : 'Unknown Title';

        const companyEl = card.querySelector(
          '.job-card-container__company-name, .artdeco-entity-lockup__subtitle, span.job-card-container__primary-description'
        );
        const company = companyEl ? companyEl.innerText.trim() : 'Unknown Company';

        const locEl = card.querySelector(
          '.job-card-container__metadata-item, .artdeco-entity-lockup__caption'
        );
        const location = locEl ? locEl.innerText.trim() : '';

        if (!jobId) {
          const cleanC = company.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
          const cleanT = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
          jobId = `hash_${cleanC}_${cleanT}`;
        }

        const cardText = (card.innerText || '').trim();
        let isAppliedOnLinkedIn = false;
        const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
        const nonTitleLines = lines.filter(l => l.toLowerCase() !== title.toLowerCase());
        for (const line of nonTitleLines) {
          const l = line.trim().toLowerCase();
          if (
            l === 'applied' ||
            l === 'application submitted' ||
            /^applied\s*[·•-]\s*easy apply/i.test(l) ||
            /^applied\s+\d+[mhdwy]\s+ago/i.test(l) ||
            /^applied\s+on\s+/i.test(l) ||
            /^applied\s+(today|yesterday)/i.test(l)
          ) {
            isAppliedOnLinkedIn = true;
            break;
          }
        }

        const hasEasyApply = !!card.querySelector(
          '.job-card-container__apply-method, [aria-label*="Easy Apply"], .job-card-list__easy-apply-label'
        ) || cardText.toLowerCase().includes('easy apply');

        results.push({
          index: i,
          jobId: String(jobId),
          title,
          company,
          location,
          hasEasyApply,
          isAppliedOnLinkedIn
        });
      }

      return results;
    });

    if (update) update(`Extracted ${jobs.length} total listings from page.`);

    // Checkpoint A: Auto-sync any jobs displaying an "Applied" badge on LinkedIn into tracker history
    let historySyncedCount = 0;
    for (const j of jobs) {
      if (j.isAppliedOnLinkedIn && !tracker.hasApplied(j)) {
        tracker.record({
          ...j,
          status: 'applied',
          notes: 'Already applied on LinkedIn (detected from search history badge)'
        });
        historySyncedCount++;
      }
    }
    if (historySyncedCount > 0 && update) {
      update(`🔖 Synchronized ${historySyncedCount} previously applied jobs from LinkedIn search history.`);
    }

    // Checkpoint B: Filter out jobs that are blacklisted or already applied (in tracker OR on LinkedIn)
    let skippedHistoryCount = 0;
    const filtered = jobs.filter(j => {
      const requireEasyApply = settings.search?.easyApplyOnly === true || settings.search?.applyType === 'easy_apply';
      if (requireEasyApply && !j.hasEasyApply) return false;

      const isBlacklisted = blacklist.some(b => j.company.toLowerCase().includes(b));
      if (isBlacklisted) return false;

      // History checkpoint: prevent applying again to any job already applied
      if (j.isAppliedOnLinkedIn || tracker.hasApplied(j)) {
        skippedHistoryCount++;
        return false;
      }

      return true;
    });

    if (skippedHistoryCount > 0 && update) {
      update(`🛡️ History filter: Skipped ${skippedHistoryCount} jobs that were already applied previously.`);
    }

    return filtered;
  }

  /**
   * Select a specific job card to load its details pane
   */
  async selectJob(page, job, update) {
    update(`Selecting job: "${job.title}" at "${job.company}"...`);

    let selected = false;

    // 1. In modern LazyColumn, click card by index
    try {
      const cards = await page.$$('[data-testid="lazy-column"] div[role="button"]');
      if (cards && cards.length > job.index && job.index !== undefined) {
        await cards[job.index].scrollIntoViewIfNeeded();
        await this.bridge.humanDelay(300, 600);
        await cards[job.index].click();
        await this.bridge.humanDelay(1500, 2500);
        selected = true;
      }
    } catch (e) {}

    // 2. Try classic selector by jobId
    if (!selected && job.jobId && /^\d+$/.test(job.jobId)) {
      try {
        const cardSelector = `[data-occludable-job-id="${job.jobId}"], [data-job-id="${job.jobId}"]`;
        const card = await page.$(cardSelector);
        if (card) {
          await card.scrollIntoViewIfNeeded();
          await card.click();
          await this.bridge.humanDelay(1500, 2500);
          selected = true;
        }
      } catch (e) {}

      // 3. Direct navigation fallback if ID is numeric
      if (!selected) {
        try {
          update(`Navigating directly to job ID ${job.jobId}...`);
          await page.goto(`https://www.linkedin.com/jobs/view/${job.jobId}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
          });
          await this.bridge.humanDelay(1500, 2500);
          selected = true;
        } catch (e) {}
      }
    }

    if (selected) {
      job.description = await this.extractJobDescription(page, update);
    }

    return selected;
  }

  /**
   * Extract full job description from the details pane
   */
  async extractJobDescription(page, update) {
    try {
      // Click "See more" or "Show more" button if truncated
      const seeMoreButtons = [
        'button[aria-label*="See more"]',
        'button[aria-label*="Show more"]',
        'button:has-text("See more")',
        'button:has-text("Show more")',
        '.jobs-description__footer-button',
        '[data-testid="expandable-text-button"]'
      ];
      for (const sel of seeMoreButtons) {
        try {
          const btn = await page.$(sel);
          if (btn && await btn.isVisible()) {
            await btn.click().catch(() => {});
            await this.bridge.humanDelay(200, 400);
            break;
          }
        } catch (err) {}
      }

      // Read description text
      const selectors = [
        '#job-details',
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        'article',
        '[data-testid="job-details"]'
      ];

      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (el && await el.isVisible()) {
            const text = (await el.innerText()).trim();
            if (text.length > 40) {
              if (update) update(`📖 Extracted full job description (${text.length} chars).`);
              return text;
            }
          }
        } catch (err) {}
      }

      // Fallback
      const fallback = await page.evaluate(() => {
        const pane = document.querySelector('.jobs-search__job-details--container, .scaffold-layout__detail');
        return pane ? pane.innerText : '';
      });

      if (fallback && fallback.trim().length > 40) {
        if (update) update(`📖 Extracted job details (${fallback.trim().length} chars).`);
        return fallback.trim();
      }
    } catch (e) {}

    return '';
  }

  /**
   * Locate and evaluate the Apply button in the details view
   * Returns: { type: 'easy_apply' | 'external_apply' | 'already_applied' | 'none', element: ElementHandle }
   */
  async detectApplyButton(page, update) {
    const appliedBadgeSelectors = [
      '.jobs-s-apply__application-date',
      '.artdeco-inline-feedback--success',
      '[data-view-name*="applied"]',
      '.jobs-search-results-list__list-item--applied',
      'span.jobs-s-apply__application-date',
      '.jobs-details__top-card .artdeco-inline-feedback'
    ];

    const applyButtonSelectors = [
      'button.jobs-apply-button',
      'a.jobs-apply-button',
      'button[aria-label*="Easy Apply"]',
      'button:has-text("Easy Apply")',
      'button[aria-label*="Apply to"]',
      'a[aria-label*="Apply to"]',
      '.jobs-apply-button--top-card button',
      '.jobs-s-apply button',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '[data-control-name="jobdetails_topcard_inapply"]'
    ];

    // Retry up to 5 times (waiting up to ~5s for details pane to render)
    for (let attempt = 0; attempt < 5; attempt++) {
      // 1. Direct Check: Did LinkedIn render an "Applied on..." date or success feedback banner?
      for (const sel of appliedBadgeSelectors) {
        try {
          const el = await page.$(sel);
          if (el && await el.isVisible()) {
            const badgeText = (await el.innerText()).trim();
            if (/applied|application\s+submitted/i.test(badgeText)) {
              if (update) update(`Job details confirm already applied on LinkedIn: "${badgeText}".`);
              return { type: 'already_applied', element: el, message: badgeText };
            }
          }
        } catch (e) {}
      }

      // 2. Evaluate top-card text for "You applied on..." banner
      try {
        const topCardText = await page.evaluate(() => {
          const top = document.querySelector('.jobs-details__top-card, .job-details-jobs-unified-top-card, .jobs-unified-top-card, .scaffold-layout__detail');
          return top ? top.innerText : '';
        });
        if (topCardText && /(you applied on|applied \d+[mhdwy] ago|application submitted)/i.test(topCardText)) {
          const match = topCardText.match(/(you applied on [^\n\.]+|(?:applied\s+\d+[mhdwy]\s+ago)|application submitted)/i);
          const msg = match ? match[0] : 'Applied on LinkedIn';
          if (update) update(`Job details indicate: ${msg}`);
          return { type: 'already_applied', element: null, message: msg };
        }
      } catch (e) {}

      // 3. Inspect apply button elements
      for (const selector of applyButtonSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            const text = (await btn.innerText()).trim();
            const aria = (await btn.getAttribute('aria-label') || '').toLowerCase();

            if (/applied/i.test(text) || aria.includes('applied')) {
              if (update) update('Apply button confirms: already applied on LinkedIn.');
              return { type: 'already_applied', element: btn, message: text || 'Applied' };
            }

            if (/easy apply/i.test(text) || aria.includes('easy apply')) {
              if (update) update('Found direct LinkedIn "Easy Apply" button.');
              return { type: 'easy_apply', element: btn };
            }

            if (/apply/i.test(text) || aria.includes('apply')) {
              if (update) update('Found External Career Site "Apply" button.');
              return { type: 'external_apply', element: btn };
            }
          }
        } catch (e) {}
      }
      await this.bridge.humanDelay(700, 1200);
    }

    return { type: 'none', element: null };
  }

  /**
   * Backward-compatible helper for clicking Easy Apply
   */
  async clickEasyApplyButton(page, update) {
    const detected = await this.detectApplyButton(page, update);
    if (detected.type === 'already_applied') return 'already_applied';
    if (detected.type === 'easy_apply' && detected.element) {
      update('Clicking LinkedIn "Easy Apply" button...');
      await detected.element.click({ force: true });
      await this.bridge.humanDelay(1200, 2000);
      return true;
    }
    return false;
  }
}

module.exports = SearchEngine;
