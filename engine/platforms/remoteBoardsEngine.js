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

    return await this.externalApply.applyDirectUrl(page, job, options);
  }
}

module.exports = RemoteBoardsEngine;
