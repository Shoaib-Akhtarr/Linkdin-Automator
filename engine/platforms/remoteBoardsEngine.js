const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
const eligibilityEngine = require('../eligibilityEngine');
const tracker = require('../tracker');

class RemoteBoardsEngine {
  constructor(browserBridge, externalApplyEngine) {
    this.bridge = browserBridge;
    this.externalApply = externalApplyEngine;
    this.cachedJobs = [];
    this.lastFetchTime = 0;
  }

  /**
   * Search for remote jobs matching configured keywords from high-quality curated sources (RemoteOK API, Jobicy, etc.)
   */
  async searchJobs(settings, logCallback = () => {}) {
    const target = settings.activePlatform || 'remote_ats';
    logCallback(`🌐 Fetching remote tech & AI jobs (Target: ${target.toUpperCase()})...`);
    const keywords = settings.search?.keywords || ['AI Engineer', 'Python'];
    const collectedJobs = [];
    const seenUrls = new Set();

    // Use cached feed if fetched within last 2 minutes for same platform target
    const now = Date.now();
    if (this.cachedJobs.length > 0 && this.cachedPlatform === target && now - this.lastFetchTime < 2 * 60 * 1000) {
      logCallback(`✓ Using cached feed (${this.cachedJobs.length} roles).`);
      return this.filterJobsByKeywords(this.cachedJobs, keywords);
    }

    const shouldFetchRemoteOK = (target === 'all' || target === 'remote_ats' || target === 'remoteok');
    const shouldFetchJobicy = (target === 'all' || target === 'remote_ats' || target === 'jobicy');
    const shouldFetchWWR = (target === 'all' || target === 'remote_ats' || target === 'weworkremotely');
    const shouldFetchRemotive = (target === 'all' || target === 'remote_ats' || target === 'remotive');

    // 1. RemoteOK Feed
    if (shouldFetchRemoteOK) {
      try {
        logCallback('📡 Connecting to RemoteOK feed...');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const res = await fetch('https://remoteok.com/api', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 1) {
            const items = data.slice(1);
            let rokCount = 0;
            for (const item of items) {
              const title = (item.position || '').trim();
              const company = (item.company || '').trim();
              const url = item.apply_url || item.url || '';
              if (!title || !company || !url || seenUrls.has(url)) continue;

              seenUrls.add(url);
              rokCount++;
              collectedJobs.push({
                jobId: `remote_${item.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                platform: 'remoteok',
                title,
                company,
                location: item.location || 'Remote',
                url,
                tags: item.tags || [],
                description: item.description ? item.description.replace(/<[^>]*>?/gm, ' ') : `${title} at ${company}`,
                source: 'RemoteOK'
              });
            }
            logCallback(`✓ Sourced ${rokCount} listings from RemoteOK (Total: ${collectedJobs.length}).`);
          }
        }
      } catch (err) {
        logCallback(`⚠️ RemoteOK feed note: ${err.message}.`);
      }
    }

    // 2. Jobicy API Feeds (Engineering & Dev)
    if (shouldFetchJobicy) {
      try {
        logCallback('📡 Connecting to Jobicy Remote feeds...');
        const jobicyEndpoints = [
          'https://jobicy.com/api/v2/remote-jobs?count=100&industry=engineering',
          'https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev'
        ];
        let jCount = 0;
        for (const ep of jobicyEndpoints) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);

            const res = await fetch(ep, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
              },
              signal: controller.signal
            });
            clearTimeout(timer);

            if (res.ok) {
              const data = await res.json();
              if (data && Array.isArray(data.jobs)) {
                for (const item of data.jobs) {
                  const title = (item.jobTitle || '').trim();
                  const company = (item.companyName || '').trim();
                  const url = item.url || '';
                  if (!title || !company || !url || seenUrls.has(url)) continue;

                  seenUrls.add(url);
                  jCount++;
                  collectedJobs.push({
                    jobId: `jobicy_${item.id || Date.now()}`,
                    platform: 'jobicy',
                    title,
                    company,
                    location: item.jobGeo || 'Remote',
                    url,
                    tags: item.jobType ? [item.jobType] : [],
                    description: item.jobDescription ? item.jobDescription.replace(/<[^>]*>?/gm, ' ') : `${title} at ${company}`,
                    source: 'Jobicy'
                  });
                }
              }
            }
          } catch (_) {}
        }
        if (jCount > 0) {
          logCallback(`✓ Sourced ${jCount} listings from Jobicy (Total: ${collectedJobs.length}).`);
        }
      } catch (err2) {
        logCallback(`⚠️ Jobicy feed note: ${err2.message}`);
      }
    }

    // 3. WeWorkRemotely Feeds (All Programming & Tech Remote Categories)
    if (shouldFetchWWR) {
      try {
        logCallback('📡 Connecting to We Work Remotely feeds...');
        const wwrFeeds = [
          'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
          'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
          'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
          'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
          'https://weworkremotely.com/categories/remote-programming-jobs.rss',
          'https://weworkremotely.com/remote-jobs.rss'
        ];
        let wwrCount = 0;
        for (const feedUrl of wwrFeeds) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(feedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
              },
              signal: controller.signal
            });
            clearTimeout(timer);

            if (res.ok) {
              const xml = await res.text();
              const items = xml.split('<item>').slice(1);
              for (const it of items) {
                const titleMatch = it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || it.match(/<title>(.*?)<\/title>/);
                const linkMatch = it.match(/<link>(.*?)<\/link>/);
                const descMatch = it.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s) || it.match(/<description>(.*?)<\/description>/s);

                const rawTitle = titleMatch ? titleMatch[1].trim() : '';
                const url = linkMatch ? linkMatch[1].trim() : '';
                if (!rawTitle || !url || seenUrls.has(url)) continue;

                // Format: "Company: Title"
                let company = '';
                let title = rawTitle;
                if (rawTitle.includes(':')) {
                  const parts = rawTitle.split(':');
                  company = parts[0].trim();
                  title = parts.slice(1).join(':').trim();
                } else {
                  // Extract company from URL slug (e.g. /remote-jobs/company-name-role-title-1)
                  const slugMatch = url.match(/\/remote-jobs\/([a-z0-9-]+?)-[a-z0-9-]+$/i);
                  if (slugMatch) {
                    company = slugMatch[1].replace(/-/g, ' ');
                  } else {
                    company = 'WWR Employer';
                  }
                }

                seenUrls.add(url);
                wwrCount++;
                collectedJobs.push({
                  jobId: `wwr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  platform: 'weworkremotely',
                  title,
                  company,
                  location: 'Remote',
                  url,
                  tags: ['remote', 'weworkremotely'],
                  description: descMatch ? descMatch[1].replace(/<[^>]*>?/gm, ' ').replace(/&[a-z]+;/gi, ' ').trim() : `${title} at ${company}`,
                  source: 'We Work Remotely'
                });
              }
            }
          } catch (_) {}
        }
        if (wwrCount > 0) {
          logCallback(`✓ Sourced ${wwrCount} listings from We Work Remotely (Total: ${collectedJobs.length}).`);
        }
      } catch (err3) {
        logCallback(`⚠️ We Work Remotely feed note: ${err3.message}`);
      }
    }

    // 4. Remotive API Feed (Curated Tech & Software Dev)
    if (shouldFetchRemotive || collectedJobs.length < 40) {
      try {
        logCallback('📡 Connecting to Remotive curated remote feed...');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch('https://remotive.com/api/remote-jobs?category=software-dev&limit=100', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.jobs)) {
            let rmtCount = 0;
            for (const item of data.jobs) {
              const title = (item.title || '').trim();
              const company = (item.company_name || '').trim();
              const url = item.url || '';
              if (!title || !company || !url || seenUrls.has(url)) continue;

              seenUrls.add(url);
              rmtCount++;
              collectedJobs.push({
                jobId: `remotive_${item.id || Date.now()}`,
                platform: 'remote_ats',
                title,
                company,
                location: item.candidate_required_location || 'Remote',
                url,
                tags: item.tags || ['remote', 'software-dev'],
                description: item.description ? item.description.replace(/<[^>]*>?/gm, ' ') : `${title} at ${company}`,
                source: 'Remotive'
              });
            }
            if (rmtCount > 0) {
              logCallback(`✓ Sourced ${rmtCount} listings from Remotive (Total: ${collectedJobs.length}).`);
            }
          }
        }
      } catch (err4) {
        logCallback(`⚠️ Remotive feed note: ${err4.message}`);
      }
    }

    this.cachedJobs = collectedJobs;
    this.cachedPlatform = target;
    this.lastFetchTime = Date.now();

    let filtered = this.filterJobsByKeywords(collectedJobs, keywords);
    let freshCount = filtered.filter(j => !tracker.findPriorApplication(j)).length;

    // If a specific platform feed was 100% already applied, automatically pull in fresh unapplied tech roles from the broader curated network
    if (freshCount === 0 && filtered.length > 0 && target !== 'all' && target !== 'remote_ats') {
      logCallback(`ℹ️ All ${filtered.length} matching listings on ${target.toUpperCase()} have already been applied to in prior sessions.`);
      logCallback(`🌐 Expanding to broader curated remote network to supply fresh, unapplied roles...`);
      const fallbackSettings = { ...settings, activePlatform: 'remote_ats' };
      return await this.searchJobs(fallbackSettings, logCallback);
    }

    logCallback(`✓ Found ${filtered.length} matching candidate roles (${freshCount} fresh unapplied) from ${target.toUpperCase()}.`);
    return filtered;
  }

  filterJobsByKeywords(jobs, keywords) {
    return jobs.filter(job => {
      const text = `${job.title} ${(job.tags || []).join(' ')} ${job.description}`.toLowerCase();
      return keywords.some(k => text.includes(k.toLowerCase().trim()));
    });
  }

  /**
   * Apply directly to a curated remote job using external ATS auto-filler
   */
  async applyJob(page, job, options = {}) {
    const update = options.onStatusUpdate || (() => {});
    update(`⚡ Starting application for "${job.title}" at "${job.company}" on Curated Remote ATS (${job.source || 'Remote Board'})...`);

    // Pre-flight check before touching the browser or loading any external site
    const preFlight = tracker.evaluatePreFlightClass(job);
    if (preFlight.action === 'SKIP') {
      if (preFlight.class === 'DONE') {
        update(`⏭️ Pre-flight: Already applied within 90d. Skipping.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_ALREADY_APPLIED', reason: 'Already applied' };
      }
      if (preFlight.class === 'HOLD') {
        update(`⏸️ Pre-flight: Job on HOLD (${preFlight.reason}). Awaiting candidate clearance.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_HOLD_PENDING_USER', reason: preFlight.reason };
      }
      if (preFlight.class === 'COOLDOWN') {
        update(`⏳ Pre-flight: Job in COOLDOWN (${preFlight.daysLeft || 7}d remaining, attempts: ${preFlight.attemptsCount}). Skipping.`);
        return { status: 'skipped', code: 'CODE_PREFLIGHT_COOLDOWN', reason: preFlight.reason };
      }
    }

    // If listing is from WeWorkRemotely, visit page to resolve direct employer ATS career portal URL
    if (job.url && job.url.includes('weworkremotely.com')) {
      try {
        update(`🌐 [We Work Remotely] Resolving direct ATS portal URL for "${job.title}"...`);
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(1500, 2500);

        const destinationUrl = await page.evaluate(() => {
          const btn = document.querySelector('#job-cta-alt, a#job-cta, a.apply-button, a.apply, [id*="job-cta"]');
          let target = btn ? btn.getAttribute('href') : null;
          if (!target || target.includes('find-your-plan') || target.includes('/job-seekers/account/')) {
            const candidate = Array.from(document.querySelectorAll('a')).find(a => 
              /apply now|apply for this position/i.test(a.innerText) && 
              !/find-your-plan/i.test(a.href) && 
              !/job-seekers/i.test(a.href)
            );
            target = candidate ? candidate.getAttribute('href') : null;
          }
          return target;
        });

        if (destinationUrl && destinationUrl.startsWith('http')) {
          update(`✓ Resolved direct ATS portal: ${destinationUrl.slice(0, 65)}...`);
          job.url = destinationUrl;
        }
      } catch (wwrErr) {
        update(`⚠️ WWR portal resolution note: ${wwrErr.message}`);
      }
    }

    // If listing is from RemoteOK, resolve direct employer ATS career portal URL
    if (job.url && job.url.includes('remoteok.com')) {
      try {
        update(`🌐 [RemoteOK] Resolving direct employer ATS portal for "${job.title}"...`);
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(1500, 2500);

        // 1. Look for direct external ATS links on RemoteOK page
        const directAtsHref = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href]'));
          for (const a of links) {
            const h = a.href || '';
            if ((h.includes('greenhouse.io') || h.includes('lever.co') || h.includes('ashbyhq.com') ||
                 h.includes('myworkdayjobs.com') || h.includes('smartrecruiters.com') || h.includes('bamboohr.com') ||
                 h.includes('workable.com') || h.includes('rippling.com')) && !h.includes('remoteok.com')) {
              return h;
            }
          }
          return null;
        });

        if (directAtsHref) {
          update(`✓ Resolved direct ATS portal from RemoteOK: ${directAtsHref.slice(0, 65)}...`);
          job.url = directAtsHref;
        } else {
          // 2. Click the Apply button on RemoteOK and capture destination / popup
          const applyBtn = await page.$(
            'a.prevent-default.apply, a.apply, a:has-text("Apply for this job"), a:has-text("Apply now"), button:has-text("Apply now")'
          );

          if (applyBtn && await applyBtn.isVisible().catch(() => false)) {
            const newPagePromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
            await applyBtn.click({ force: true }).catch(() => {});
            await this.bridge.humanDelay(2000, 3500);

            const popup = await newPagePromise;
            if (popup) {
              await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
              const popupUrl = popup.url();
              if (popupUrl && !popupUrl.includes('remoteok.com') && popupUrl.startsWith('http')) {
                update(`✓ Captured external ATS tab from RemoteOK: ${popupUrl.slice(0, 65)}...`);
                job.url = popupUrl;
                const result = await this.externalApply.applyDirectUrl(popup, job, options);
                await popup.close().catch(() => {});
                return result;
              }
              await popup.close().catch(() => {});
            }

            // Check if page navigated or revealed an external link / modal
            const currentUrl = page.url();
            if (currentUrl && !currentUrl.includes('remoteok.com') && currentUrl.startsWith('http')) {
              update(`✓ Navigated to employer portal: ${currentUrl.slice(0, 65)}...`);
              job.url = currentUrl;
            } else {
              // Check if modal or expand revealed an outbound link
              const revealedLink = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href^="http"]'));
                const ext = links.find(a => 
                  !a.href.includes('remoteok.com') && 
                  !a.href.includes('twitter.com') && 
                  !a.href.includes('facebook.com') && 
                  !a.href.includes('linkedin.com') && 
                  /apply|jobs|career/i.test(a.href)
                );
                return ext ? ext.href : null;
              });

              if (revealedLink) {
                update(`✓ Found revealed outbound application link: ${revealedLink.slice(0, 65)}...`);
                job.url = revealedLink;
              }
            }
          }
        }
      } catch (rokErr) {
        update(`⚠️ RemoteOK portal resolution note: ${rokErr.message}`);
      }

      // If job.url is still on RemoteOK, it cannot be auto-applied directly
      if (job.url && job.url.includes('remoteok.com')) {
        update(`⚠️ Could not resolve direct employer ATS from RemoteOK listing. Skipping.`);
        return { status: 'skipped', code: 'CODE_REMOTEOK_UNRESOLVED', reason: 'Could not resolve outbound employer ATS portal' };
      }
    }

    // If listing is from Jobicy, resolve direct employer ATS career portal URL
    if (job.url && job.url.includes('jobicy.com')) {
      try {
        update(`🌐 [Jobicy] Resolving direct employer ATS portal for "${job.title}"...`);
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.bridge.humanDelay(1500, 2500);

        const resolved = await page.evaluate(async () => {
          // 1. Check for standard external ATS links anywhere on the page
          const links = Array.from(document.querySelectorAll('a[href]'));
          for (const a of links) {
            const h = a.href || '';
            if ((h.includes('greenhouse.io') || h.includes('lever.co') || h.includes('ashbyhq.com') || h.includes('myworkdayjobs.com') || h.includes('smartrecruiters.com') || h.includes('bamboohr.com') || h.includes('rippling.com')) && !h.includes('jobicy.com')) {
              return { url: h };
            }
          }

          // 2. Try resolving via signals.php with page credentials
          const actionMatch = document.documentElement.innerHTML.match(/action:\s*['"]([a-z0-9_]+)['"],\s*nonce:\s*['"]([a-z0-9_]+)['"],\s*post_id:\s*(\d+)/i);
          if (actionMatch) {
            const [, action, nonce, postId] = actionMatch;
            try {
              const res = await fetch('/signals.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest',
                  'X-Jobicy-Ajax': 'true'
                },
                body: new URLSearchParams({ action, nonce, post_id: postId, increment_clicks: 'true' })
              });
              const json = await res.json();
              if (json && json.url && typeof json.url === 'string' && json.url.startsWith('http')) {
                return { url: json.url };
              }
              if (json && json.data && json.data.message && json.data.message.toLowerCase().includes('sign in')) {
                return { requiresAuth: true, message: json.data.message };
              }
            } catch (_) {}
          }

          // 3. Check for sign-in gate modal on page
          const authBtn = document.querySelector('#jv-open-apply-auth, .jv-apply-primary');
          if (authBtn) {
            return { requiresAuth: true, message: 'Jobicy login required to reveal employer apply link' };
          }

          return null;
        });

        if (resolved && resolved.url) {
          update(`✓ Resolved direct ATS portal: ${resolved.url.slice(0, 65)}...`);
          job.url = resolved.url;
        } else if (resolved && resolved.requiresAuth) {
          update(`⚠️ [Jobicy] Employer apply link is gated behind Jobicy sign-in. Please log in to Jobicy in Chrome to enable Jobicy applications.`);
          return { status: 'skipped', code: 'CODE_JOBICY_SIGNIN_REQUIRED', reason: 'Jobicy account sign-in required' };
        }
      } catch (jobicyErr) {
        update(`⚠️ Jobicy portal resolution note: ${jobicyErr.message}`);
      }
    }

    return await this.externalApply.applyDirectUrl(page, job, options);
  }
}

module.exports = RemoteBoardsEngine;
