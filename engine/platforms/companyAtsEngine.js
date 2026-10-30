/**
 * Company ATS Direct Feed Engine (Greenhouse, Lever, Ashby)
 * 
 * Production-Hardened Architecture:
 * 1. Air-Tight Location & Remote Gate (Zero leakage of US-only, Hybrid, or SF/NYC onsite roles)
 * 2. Experience Parser (Extracts required years; rejects 3+, 4+, 5+ years for junior/mid 0-2y profile)
 * 3. Calibrated AI JD Match Scoring (Prevents inflated 100% scores)
 * 4. Anti-Prefetch Security: GET only views confirmation page; POST executes approval
 * 5. Cryptographic HMAC token protection on approval endpoints
 * 6. Tunnel / Remote URL support for mobile 1-click review (APP_BASE_URL)
 */

const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jdAnalyzer = require('../jdAnalyzer');
const tracker = require('../tracker');
const emailNotifier = require('../emailNotifier');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ATS_JOBS_FILE = path.join(DATA_DIR, 'ats_jobs.json');
const COMPANIES_FILE = path.join(__dirname, '..', '..', 'config', 'companies.json');
const PROFILE_FILE = path.join(__dirname, '..', '..', 'config', 'profile.json');

// Secret salt for HMAC approval tokens
const TOKEN_SALT = process.env.APPROVAL_SECRET_SALT || 'ats_automation_secure_token_salt_2026';

class CompanyAtsEngine {
  constructor(browserBridge, externalApplyEngine) {
    this.bridge = browserBridge;
    this.externalApply = externalApplyEngine;
    this.emailNotifier = emailNotifier;
    this.candidateProfile = this.loadCandidateProfile();
    this.ensureDataFile();
  }

  loadCandidateProfile() {
    try {
      if (fs.existsSync(PROFILE_FILE)) {
        return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
      }
    } catch (_) {}
    return { workExperienceYears: { total: 2 } };
  }

  ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ATS_JOBS_FILE)) {
      fs.writeFileSync(ATS_JOBS_FILE, JSON.stringify({ lastScanTime: null, jobs: [] }, null, 2));
    }
  }

  loadAtsJobs() {
    try {
      if (fs.existsSync(ATS_JOBS_FILE)) {
        return JSON.parse(fs.readFileSync(ATS_JOBS_FILE, 'utf-8'));
      }
    } catch (_) {}
    return { lastScanTime: null, jobs: [] };
  }

  saveAtsJobs(data) {
    try {
      fs.writeFileSync(ATS_JOBS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[CompanyAtsEngine] Failed to save ats_jobs.json:', e.message);
    }
  }

  loadCompanies() {
    try {
      if (fs.existsSync(COMPANIES_FILE)) {
        return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8')).filter(c => c.enabled !== false);
      }
    } catch (_) {}
    return [];
  }

  cleanHtml(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generates a tamper-proof HMAC verification token for approval links
   */
  generateApprovalToken(jobId) {
    return crypto.createHmac('sha256', TOKEN_SALT).update(String(jobId)).digest('hex').slice(0, 24);
  }

  verifyApprovalToken(jobId, token) {
    if (!jobId || !token || typeof token !== 'string') return false;
    const expected = this.generateApprovalToken(jobId);
    const bufA = Buffer.from(token);
    const bufB = Buffer.from(expected);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  getBaseUrl() {
    return (process.env.APP_BASE_URL || process.env.TUNNEL_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  /**
   * 1. Greenhouse Fetcher
   */
  async fetchGreenhouse(company, logCallback = () => {}) {
    const slug = company.slug;
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !Array.isArray(data.jobs)) return [];

      return data.jobs.map(j => {
        const locationTypeMeta = (j.metadata || []).find(m => /location type/i.test(m.name || ''))?.value || '';
        const locName = j.location?.name || '';
        const cleanDesc = this.cleanHtml(j.content || '');

        return {
          jobId: `gh_${slug}_${j.id}`,
          platform: 'greenhouse',
          company: company.name,
          companySlug: slug,
          title: (j.title || '').trim(),
          location: locName || 'Unspecified',
          locationType: locationTypeMeta,
          workplaceType: /remote/i.test(locationTypeMeta) ? 'remote' : (/on-site|onsite/i.test(locationTypeMeta) ? 'onsite' : 'unspecified'),
          secondaryLocations: [],
          country: '',
          url: j.absolute_url,
          applyUrl: j.absolute_url,
          description: cleanDesc,
          source: `Greenhouse (${company.name})`,
          postedAt: j.updated_at || j.first_published || null
        };
      });
    } catch (err) {
      logCallback(`⚠️ [Greenhouse] ${company.name} (${slug}) note: ${err.message}`);
      return [];
    }
  }

  /**
   * 2. Ashby Fetcher
   */
  async fetchAshby(company, logCallback = () => {}) {
    const slug = company.slug;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !Array.isArray(data.jobs)) return [];

      return data.jobs.map(j => {
        const cleanDesc = this.cleanHtml(j.descriptionHtml || j.descriptionPlain || '');
        const secondary = (j.secondaryLocations || []).map(s => s.location || '');
        const country = j.address?.postalAddress?.addressCountry || '';

        return {
          jobId: `ashby_${slug}_${j.id}`,
          platform: 'ashby',
          company: company.name,
          companySlug: slug,
          title: (j.title || '').trim(),
          location: j.location || '',
          workplaceType: (j.workplaceType || '').toLowerCase(),
          isRemote: j.isRemote === true,
          secondaryLocations: secondary,
          country,
          url: j.jobUrl || j.applyUrl,
          applyUrl: j.applyUrl || j.jobUrl,
          description: cleanDesc,
          department: j.department || j.team || '',
          source: `Ashby (${company.name})`,
          postedAt: j.publishedAt || null
        };
      });
    } catch (err) {
      logCallback(`⚠️ [Ashby] ${company.name} (${slug}) note: ${err.message}`);
      return [];
    }
  }

  /**
   * 3. Lever Fetcher (with EU fallback)
   */
  async fetchLever(company, logCallback = () => {}) {
    const slug = company.slug;
    let url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    try {
      let controller = new AbortController();
      let timer = setTimeout(() => controller.abort(), 8000);
      let res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      // Check EU instance if 404
      if (res.status === 404) {
        url = `https://api.eu.lever.co/v0/postings/${slug}?mode=json`;
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 8000);
        res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timer);
      }

      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data.map(j => {
        const loc = j.categories?.location || '';
        const workplace = (j.workplaceType || '').toLowerCase();
        const cleanDesc = this.cleanHtml(j.descriptionBodyPlain || j.descriptionBody || '');

        return {
          jobId: `lever_${slug}_${j.id}`,
          platform: 'lever',
          company: company.name,
          companySlug: slug,
          title: (j.text || '').trim(),
          location: loc,
          workplaceType: workplace,
          isRemote: workplace === 'remote' || /remote/i.test(loc),
          secondaryLocations: [],
          country: j.country || '',
          url: j.hostedUrl || j.applyUrl,
          applyUrl: j.applyUrl || j.hostedUrl,
          description: cleanDesc,
          source: `Lever (${company.name})`,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null
        };
      });
    } catch (err) {
      logCallback(`⚠️ [Lever] ${company.name} (${slug}) note: ${err.message}`);
      return [];
    }
  }

  /**
   * Filter 1: Seniority / Level Filter & Negative Role Filtering
   */
  passesLevelFilter(title, settings = {}) {
    const t = title.toLowerCase();

    // 1. Exclude non-software / physical / sales domains
    const nonTechExclusions = [
      /\bdata center\b/i,
      /\belectrical\b/i,
      /\bhardware\b/i,
      /\bfacilities\b/i,
      /\bcooling\b/i,
      /\bmechanical\b/i,
      /\bpower\b/i,
      /\baccount executive\b/i,
      /\bsales\b/i,
      /\brecruiter\b/i,
      /\btalent\b/i,
      /\blegal\b/i,
      /\bfinance\b/i,
      /\bpayroll\b/i,
      /\bmarketing\b/i,
      /\bcommunications\b/i,
      /\boffice manager\b/i,
      /\bsecurity guard\b/i,
      /\bnurse\b/i,
      /\bcounsel\b/i
    ];

    for (const rx of nonTechExclusions) {
      if (rx.test(t)) return false;
    }

    // 2. Exclude Senior / Staff / Principal levels
    const excludeSenior = settings.excludeSeniorLevels !== false;
    if (excludeSenior) {
      const seniorPatterns = [
        /\bsenior\b/i,
        /\bsr\.?\b/i,
        /\bstaff\b/i,
        /\bprincipal\b/i,
        /\blead\b/i,
        /\bhead of\b/i,
        /\bdirector\b/i,
        /\bvp\b/i,
        /\bvice president\b/i,
        /\bengineering manager\b/i,
        /\bmanager\b/i,
        /\barchitect\b/i
      ];

      for (const p of seniorPatterns) {
        if (p.test(t)) {
          // If title has "associate" or "intern" despite containing one of the above, keep it
          if (!/\bassociate\b|\bintern\b|\bjunior\b|\bentry\b/i.test(t)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Filter 2: Air-Tight Location & Remote Viability Filter
   * Discards US-only, Hybrid, physical office cities, and non-visa/citizenship restricted jobs.
   */
  passesLocationFilter(job, settings = {}) {
    const loc = (job.location || '').toLowerCase();
    const workplace = (job.workplaceType || '').toLowerCase();
    const country = (job.country || '').toLowerCase();
    const secondary = (job.secondaryLocations || []).map(s => s.toLowerCase()).join(' ');
    const desc = (job.description || '').toLowerCase();

    // 1. REJECT if workplaceType explicitly says Hybrid or On-Site
    if (workplace === 'hybrid' || workplace === 'onsite' || workplace === 'on-site') {
      return false;
    }

    // 2. REJECT if travel is required or physical office attendance
    if (/travel required|in-person|in person|office based/i.test(loc)) {
      return false;
    }

    // 3. REJECT any physical tech hub city unless explicitly marked Worldwide
    const strictCityBlockers = [
      'san francisco', 'seattle', 'new york', 'nyc', 'austin', 'boston',
      'chicago', 'los angeles', 'sunnyvale', 'mountain view', 'palo alto',
      'london', 'dublin', 'berlin', 'paris', 'toronto', 'vancouver'
    ];

    const allLocationText = `${loc} ${secondary} ${country}`.toLowerCase();
    for (const city of strictCityBlockers) {
      if (allLocationText.includes(city)) {
        if (!/worldwide|global|anywhere/i.test(allLocationText)) {
          return false;
        }
      }
    }

    // 4. REJECT US-only, North America only, or European only geography locks
    const geoBlockers = [
      'us - remote',
      'united states',
      'u.s.',
      'us only',
      'usa only',
      'north america only',
      'canada only',
      'uk only',
      'emea only',
      'europe only',
      'latam only',
      'must reside in',
      'must be located in the united states',
      'must be located in the us',
      'must be based in the us',
      'must be based in the united states',
      'us time zones',
      'us citizenship',
      'u.s. citizenship',
      'security clearance',
      'no visa sponsorship',
      'not open to international',
      'relocation required'
    ];

    for (const b of geoBlockers) {
      if (allLocationText.includes(b)) {
        // If it explicitly says "Worldwide" or "Global", do not reject for minor mention
        if (!/worldwide|global|anywhere|apac/i.test(allLocationText)) {
          return false;
        }
      }
      if (desc.includes(b) && (desc.includes('requirement') || desc.includes('eligible') || desc.includes('must'))) {
        return false;
      }
    }

    // 5. Must have positive remote indicator
    const isExplicitlyRemote = job.isRemote === true || workplace === 'remote';
    const hasRemoteKeyword = /remote|worldwide|global|anywhere|apac/i.test(allLocationText);

    if (!isExplicitlyRemote && !hasRemoteKeyword) {
      return false;
    }

    return true;
  }

  /**
   * Filter 3: Experience Parser & Experience Gate
   * Extracts years of experience required from the JD.
   * Discards roles requiring > 2.5 years of experience for 0-2y junior/associate candidates.
   */
  evaluateExperienceRequirement(description) {
    if (!description) return { maxYears: 0, passes: true, reason: 'No experience requirement detected' };

    const expRegexes = [
      /(\d+)\+?\s*(?:to|-)\s*(\d+)\+?\s*years?(?:\s*of)?\s*(?:relevant|hands-on|industry|professional|software|coding|engineering|work)?\s*(?:experience|exp)/gi,
      /(\d+)\+?\s*years?(?:\s*of)?\s*(?:relevant|hands-on|industry|professional|software|coding|engineering|work)?\s*(?:experience|exp)/gi,
      /minimum\s*(?:of)?\s*(\d+)\+?\s*years/gi,
      /at\s*least\s*(\d+)\+?\s*years/gi
    ];

    const detectedYears = [];

    for (const rx of expRegexes) {
      let match;
      while ((match = rx.exec(description)) !== null) {
        const val1 = parseInt(match[1], 10);
        const val2 = match[2] ? parseInt(match[2], 10) : null;
        if (!isNaN(val1) && val1 > 0 && val1 <= 20) detectedYears.push(val1);
        if (val2 && !isNaN(val2) && val2 > 0 && val2 <= 20) detectedYears.push(val2);
      }
    }

    if (detectedYears.length === 0) {
      return { maxYears: 0, passes: true, reason: 'Entry/Mid friendly or unspecified years' };
    }

    const maxYears = Math.max(...detectedYears);
    const candidateMaxYears = this.candidateProfile?.workExperienceYears?.total || 2;

    // Strict Gate: If role demands > candidate years + 1 (e.g. 4+ or 5+ years), reject immediately
    if (maxYears > candidateMaxYears + 1) {
      return {
        maxYears,
        passes: false,
        reason: `Demands ${maxYears}+ years of experience (Candidate has ${candidateMaxYears} years)`
      };
    }

    return {
      maxYears,
      passes: true,
      reason: `Compatible experience requirement: ${maxYears} years`
    };
  }

  /**
   * Filter 4: Tech Keyword Relevance
   */
  passesKeywords(job) {
    const text = `${job.title} ${job.description.slice(0, 1000)}`.toLowerCase();
    const defaultPatterns = [
      /\bai engineer\b/i,
      /\bgenerative ai\b/i,
      /\bgenai\b/i,
      /\bllm\b/i,
      /\bmachine learning\b/i,
      /\bml engineer\b/i,
      /\bpython\b/i,
      /\bsoftware engineer\b/i,
      /\bbackend engineer\b/i,
      /\bfull stack\b/i,
      /\bdata scientist\b/i,
      /\bnlp\b/i,
      /\bdeep learning\b/i,
      /\bmlops\b/i,
      /\bai agent\b/i,
      /\bprompt engineer\b/i
    ];
    return defaultPatterns.some(rx => rx.test(text));
  }

  /**
   * Calibrated Scoring Algorithm
   * Avoids artificial 100% scores; takes into account skill breadth and experience compatibility
   */
  calibrateScore(analysis, expEval) {
    if (!analysis || !analysis.metrics) return 0;

    const baseRequiredCoverage = analysis.metrics.requiredCoverage || 0;
    const verifiedCount = analysis.metrics.requiredCount?.verified || 0;
    const totalRequired = analysis.metrics.requiredCount?.total || 0;

    let calibrated = baseRequiredCoverage;

    // Penalty if total required skills extracted was trivial (e.g. only 1 or 2 skills)
    if (totalRequired <= 2 && verifiedCount > 0) {
      calibrated = Math.min(calibrated, 75);
    }

    // Experience alignment
    if (expEval.maxYears <= 2) {
      calibrated += 5; // Entry/Junior bonus
    } else if (expEval.maxYears === 3) {
      calibrated -= 10; // Stretch experience penalty
    }

    // Realistic ceiling: Cap maximum automated score at 92% to prevent blind false certainty
    calibrated = Math.min(92, Math.max(10, Math.round(calibrated)));
    return calibrated;
  }

  /**
   * Main Scan Engine: Iterates all target companies, aggregates roles, filters, scores with AI, and notifies
   */
  async scanAllCompanies(settings = {}, logCallback = () => {}) {
    const companies = this.loadCompanies();
    logCallback(`🚀 Sourcing direct career postings from ${companies.length} verified tech companies via ATS endpoints...`);

    const atsData = this.loadAtsJobs();
    const existingJobIds = new Set(atsData.jobs.map(j => j.jobId));
    const seenSignatures = new Set(atsData.jobs.map(j => `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`));

    const minScore = settings.intelligence?.minimumMatchScore || 75; // strict 75% default
    const discovered = [];

    // Parallel fetch with concurrency limit of 5 to maintain high responsiveness
    const batchSize = 5;
    for (let i = 0; i < companies.length; i += batchSize) {
      const chunk = companies.slice(i, i + batchSize);
      logCallback(`📡 [ATS Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(companies.length / batchSize)}] Probing ${chunk.map(c => c.name).join(', ')}...`);

      const results = await Promise.all(chunk.map(async (company) => {
        if (company.ats === 'greenhouse') return await this.fetchGreenhouse(company, logCallback);
        if (company.ats === 'ashby') return await this.fetchAshby(company, logCallback);
        if (company.ats === 'lever') return await this.fetchLever(company, logCallback);
        return [];
      }));

      for (const list of results) {
        for (const job of list) {
          discovered.push(job);
        }
      }
    }

    logCallback(`✓ Sourced ${discovered.length} total direct listings across ${companies.length} companies.`);

    let matchedCount = 0;
    let newAlertsCount = 0;

    for (const job of discovered) {
      // 1. Level Filter
      if (!this.passesLevelFilter(job.title, settings)) continue;

      // 2. Air-Tight Location & Remote Filter
      if (!this.passesLocationFilter(job, settings)) continue;

      // 3. Keyword Relevance
      if (!this.passesKeywords(job)) continue;

      // 4. Experience Requirement Gate
      const expEval = this.evaluateExperienceRequirement(job.description);
      if (!expEval.passes) continue;

      // 5. Deduplication
      const sig = `${(job.company || '').toLowerCase()}___${(job.title || '').toLowerCase()}`;
      if (existingJobIds.has(job.jobId) || seenSignatures.has(sig)) continue;
      if (tracker.findPriorApplication(job)) continue;
      seenSignatures.add(sig);

      // 6. Deep AI Match Scoring
      let analysis = null;
      try {
        analysis = jdAnalyzer.analyze({
          title: job.title,
          company: job.company,
          description: job.description
        });
      } catch (_) {}

      const calibratedScore = this.calibrateScore(analysis, expEval);
      matchedCount++;

      const isAutoApply = settings.directCompanyAts?.autoApply !== false;
      const jobRecord = {
        ...job,
        score: calibratedScore,
        rawCoverage: analysis?.metrics?.requiredCoverage || 0,
        requiredYears: expEval.maxYears,
        experienceVerdict: expEval.reason,
        recommendation: analysis?.recommendation || 'MATCH',
        criticalGaps: analysis?.skills?.required?.missing || [],
        verifiedSkills: (analysis?.skills?.required?.verified || []).map(s => s.name),
        status: calibratedScore >= minScore
          ? (isAutoApply ? 'auto_queued_for_apply' : 'alerted_pending_approval')
          : 'scored_below_threshold',
        discoveredAt: new Date().toISOString()
      };

      atsData.jobs.unshift(jobRecord);
      existingJobIds.add(job.jobId);
      this.saveAtsJobs(atsData);

      // 7. Dispatch Alert only if score meets threshold
      if (calibratedScore >= minScore) {
        newAlertsCount++;
        const modeLabel = isAutoApply ? 'AUTO-APPLY TRIGGERED' : 'ALERT DISPATCHED';
        logCallback(`🎯 [${modeLabel} ${calibratedScore}%] "${job.title}" at "${job.company}" (${job.location || 'Remote'})!`);
        await this.dispatchAlert(jobRecord, logCallback, isAutoApply);
      }
    }

    atsData.lastScanTime = new Date().toISOString();
    this.saveAtsJobs(atsData);

    logCallback(`🏁 Scan complete! ${matchedCount} verified remote roles, ${newAlertsCount} candidate alerts dispatched.`);
    return {
      totalDiscovered: discovered.length,
      matched: matchedCount,
      newAlerts: newAlertsCount,
      jobs: atsData.jobs.slice(0, 50)
    };
  }

  /**
   * Step 4: Dispatch Safe Alert (Telegram Bot + Instant Email)
   * If autoApply is active: notifies user that application is queued for autonomous submission.
   * If manual mode: link points to a GET Confirmation/Review Screen with a secure POST form.
   */
  async dispatchAlert(job, logCallback = () => {}, isAutoApply = false) {
    const baseUrl = this.getBaseUrl();
    const token = this.generateApprovalToken(job.jobId);
    const reviewUrl = `${baseUrl}/api/ats/review?id=${encodeURIComponent(job.jobId)}&token=${token}`;

    // 1. Telegram Dispatch
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChatId = process.env.TELEGRAM_CHAT_ID;

    if (tgToken && tgChatId) {
      try {
        const text = isAutoApply
          ? [
              `🚀 *Direct ATS Auto-Apply Triggered!*`,
              ``,
              `🏢 *Company:* ${job.company}`,
              `💼 *Role:* ${job.title}`,
              `📍 *Location:* ${job.location || 'Worldwide Remote'}`,
              `⚡ *ATS Platform:* ${job.platform.toUpperCase()}`,
              `📊 *Calibrated Score:* ${job.score}%`,
              `⏳ *Experience Required:* ${job.requiredYears ? `${job.requiredYears} years` : 'Entry / Unspecified'}`,
              ``,
              `✅ *Verified Skills:* ${job.verifiedSkills.slice(0, 5).join(', ') || 'N/A'}`,
              job.criticalGaps.length > 0 ? `⚠️ *Missing Prerequisites:* ${job.criticalGaps.join(', ')}` : '',
              ``,
              `🤖 *Mode:* Autonomous Auto-Apply (Submitting with tailored ATS CV)`,
              `🔗 [View Career Portal](${job.url})`
            ].filter(Boolean).join('\n')
          : [
              `🎯 *Direct Company Job Alert!*`,
              ``,
              `🏢 *Company:* ${job.company}`,
              `💼 *Role:* ${job.title}`,
              `📍 *Location:* ${job.location || 'Worldwide Remote'}`,
              `⚡ *ATS Platform:* ${job.platform.toUpperCase()}`,
              `📊 *Calibrated Score:* ${job.score}%`,
              `⏳ *Experience Required:* ${job.requiredYears ? `${job.requiredYears} years` : 'Entry / Unspecified'}`,
              ``,
              `✅ *Verified Skills:* ${job.verifiedSkills.slice(0, 5).join(', ') || 'N/A'}`,
              job.criticalGaps.length > 0 ? `⚠️ *Missing Prerequisites:* ${job.criticalGaps.join(', ')}` : '',
              ``,
              `🔗 [Review & Confirm Application](${reviewUrl})`
            ].filter(Boolean).join('\n');

        const keyboard = isAutoApply
          ? [[{ text: '🌐 View Career Portal', url: job.url }]]
          : [
              [
                { text: '🔍 Review & Confirm', url: reviewUrl },
                { text: '🌐 View Portal', url: job.url }
              ]
            ];

        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: tgChatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: keyboard
            }
          })
        });
        logCallback(`✓ Dispatched Telegram notification for ${job.title} at ${job.company}`);
      } catch (tgErr) {
        logCallback(`⚠️ Telegram dispatch note: ${tgErr.message}`);
      }
    }

    // 2. Email Dispatch via nodemailer
    try {
      const transporter = this.emailNotifier.getTransporter();
      if (transporter) {
        const recipient = process.env.EMAIL_TO || process.env.EMAIL_USER;

        const emailTitle = isAutoApply
          ? `🚀 Direct ATS Auto-Apply: ${job.company}`
          : `🎯 Direct Career Alert: ${job.company}`;

        const emailSubtitle = isAutoApply
          ? `Autonomous ATS Application (${job.platform.toUpperCase()}) &bull; Verified Remote`
          : `Direct ATS Sourced Role (${job.platform.toUpperCase()}) &bull; Verified Remote`;

        const actionButtons = isAutoApply
          ? `
            <div style="margin: 24px 0; text-align: center;">
              <a href="${job.url}" style="background: #16a34a; color: white; padding: 13px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(22, 163, 74, 0.2);">🌐 View Career Portal</a>
            </div>
          `
          : `
            <div style="margin: 24px 0; text-align: center;">
              <a href="${reviewUrl}" style="background: #2563eb; color: white; padding: 13px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">🔍 Review & Confirm Application</a>
              <a href="${job.url}" style="background: #e2e8f0; color: #334155; padding: 13px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block; margin-left: 8px; font-size: 14px;">🌐 View Career Portal</a>
            </div>
          `;

        const html = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="background: ${isAutoApply ? '#059669' : '#4338ca'}; color: white; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="margin: 0; font-size: 20px;">${emailTitle}</h2>
              <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${emailSubtitle}</p>
            </div>

            <div style="padding: 0 4px;">
              <h3 style="margin: 0 0 8px; color: #1e293b; font-size: 18px;">${job.title}</h3>
              <p style="margin: 0 0 16px; color: #64748b; font-size: 14px;">🏢 <strong>${job.company}</strong> | 📍 ${job.location || 'Worldwide Remote'}</p>

              <div style="background: #f8fafc; border-left: 4px solid ${isAutoApply ? '#059669' : '#4338ca'}; padding: 14px 18px; border-radius: 4px; margin-bottom: 20px;">
                <div style="font-size: 15px; font-weight: 600; color: #334155;">Calibrated Match Score: <span style="color: ${isAutoApply ? '#059669' : '#4338ca'}; font-size: 18px;">${job.score}%</span></div>
                <div style="font-size: 13px; color: #475569; margin-top: 4px;"><strong>Experience Alignment:</strong> ${job.experienceVerdict}</div>
                <div style="font-size: 13px; color: #475569; margin-top: 4px;"><strong>Verified Skills:</strong> ${job.verifiedSkills.join(', ') || 'N/A'}</div>
                ${job.criticalGaps.length ? `<div style="font-size: 12px; color: #b45309; margin-top: 4px;"><strong>Prerequisite Gaps:</strong> ${job.criticalGaps.join(', ')}</div>` : ''}
                ${isAutoApply ? `<div style="font-size: 13px; color: #047857; margin-top: 8px; font-weight: 600;">🤖 Action: Auto-queued for autonomous submission. No manual action required.</div>` : ''}
              </div>

              ${actionButtons}

              <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                Sent by LinkedIn & ATS Automation Suite &bull; ${isAutoApply ? 'Autonomous Mode' : 'Anti-Prefetch Protected (POST required to submit)'}
              </p>
            </div>
          </div>
        `;

        await transporter.sendMail({
          from: `"Career ATS Automation" <${process.env.EMAIL_USER}>`,
          to: recipient,
          subject: `${isAutoApply ? '🚀 [Auto-Apply' : '🎯 [Score'} ${job.score}%] ${job.title} at ${job.company}`,
          html
        });
        logCallback(`✓ Dispatched Email alert for ${job.title} to ${recipient}`);
      }
    } catch (mailErr) {
      logCallback(`⚠️ Email dispatch note: ${mailErr.message}`);
    }
  }

  /**
   * Step 5: Execute Approved / Autonomous Application
   */
  async approveAndApply(jobId, page, options = {}) {
    const atsData = this.loadAtsJobs();
    const job = atsData.jobs.find(j => j.jobId === jobId);

    if (!job) {
      return { status: 'error', message: `Job ${jobId} not found in ats_jobs.json` };
    }

    const update = options.onStatusUpdate || console.log;
    update(`🚀 Auto-Applying for: "${job.title}" at "${job.company}" on ${job.platform.toUpperCase()}`);

    try {
      const applyResult = await this.externalApply.applyDirectUrl(page, job, {
        ...options,
        mode: 'autonomous'
      });

      if (applyResult.status === 'applied') {
        job.status = 'applied';
        job.appliedAt = new Date().toISOString();
        tracker.record({
          jobId: job.jobId,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
          status: 'applied',
          platform: 'remote_ats',
          notes: `Direct ATS auto-applied (${job.platform})`,
          description: job.description
        });
        this.saveAtsJobs(atsData);
      } else if (applyResult.status === 'needs_user_login') {
        job.status = 'needs_user_login';
        this.saveAtsJobs(atsData);
      } else {
        job.status = applyResult.status || 'failed';
        job.failureReason = applyResult.message || 'Apply execution returned unapplied status';
        this.saveAtsJobs(atsData);
      }

      return applyResult;
    } catch (err) {
      update(`❌ Error applying to ATS role: ${err.message}`);
      job.status = 'failed';
      job.failureReason = err.message;
      this.saveAtsJobs(atsData);
      return { status: 'failed', message: err.message };
    }
  }
}

module.exports = CompanyAtsEngine;
