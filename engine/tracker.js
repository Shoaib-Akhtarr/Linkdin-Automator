const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');

class Tracker {
  constructor() {
    this.ensureDataFile();
    this.data = this.loadData();
    this.cleanDailyQuotaIfNeeded();
    this.migrateLegacyDetected();
    this.deduplicateHistory();
  }

  migrateLegacyDetected() {
    if (!Array.isArray(this.data?.applications)) return;
    let migrated = 0;
    for (const app of this.data.applications) {
      const isDetected = (app.notes && (
        app.notes.toLowerCase().includes('already applied') ||
        app.notes.toLowerCase().includes('detected from search history badge')
      ));
      if (isDetected && app.status !== 'previously_applied') {
        app.status = 'previously_applied';
        if (app.appliedAt) {
          app.detectedAt = app.appliedAt;
          app.appliedAt = null;
        }
        migrated++;
      }
    }
    if (migrated > 0) {
      console.log(`[Tracker] Migrated ${migrated} legacy detected applications to 'previously_applied' status.`);
      this.saveData();
    }
  }

  ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const initial = {
        lastResetDate: this.getTodayDateString(),
        applications: []
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    }
  }

  getTodayDateString() {
    return new Date().toISOString().split('T')[0];
  }

  loadData() {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('Error reading applications.json, resetting:', err);
      return {
        lastResetDate: this.getTodayDateString(),
        applications: []
      };
    }
  }

  saveData() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Error saving applications.json:', err);
    }
  }

  cleanDailyQuotaIfNeeded() {
    const today = this.getTodayDateString();
    if (this.data.lastResetDate !== today) {
      this.data.lastResetDate = today;
      this.saveData();
    }
  }

  /**
   * Normalize strings for bulletproof cross-check comparisons
   */
  cleanText(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/\b(inc|ltd|llc|corp|corporation|pvt|private|limited|technologies|solutions|group|consulting|holdings|services|llp|gmbh)\b/gi, '')
      .replace(/\b(verified job|urgently hiring|actively recruiting|remote|hybrid|onsite|full time|part time)\b/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Compare two job representations to detect if they are the exact same job posting
   */
  isSameJob(jobA, jobB) {
    if (!jobA || !jobB) return false;

    // 1. Direct Job ID match (numeric or exact string ID)
    const idA = String(jobA.jobId || '').trim();
    const idB = String(jobB.jobId || '').trim();
    const isRealNumeric = (id) => /^\d{6,15}$/.test(id);

    if (idA && idB) {
      if (idA === idB) return true;
      if (isRealNumeric(idA) && isRealNumeric(idB) && idA === idB) return true;
    }

    // 2. Company & Title matching
    const compA = this.cleanText(jobA.company);
    const compB = this.cleanText(jobB.company);
    if (!compA || !compB) return false;

    // Company match: exact or mutual substring match
    const companyMatches = compA === compB ||
      (compA.length >= 4 && compB.length >= 4 && (compA.includes(compB) || compB.includes(compA)));
    if (!companyMatches) return false;

    // Title match: exact or mutual substring match
    const titleA = this.cleanText(jobA.title);
    const titleB = this.cleanText(jobB.title);
    if (!titleA || !titleB) return false;

    if (titleA === titleB) return true;
    if (titleA.length >= 6 && titleB.length >= 6 && (titleA.includes(titleB) || titleB.includes(titleA))) {
      return true;
    }

    return false;
  }

  /**
   * Check if a job was already successfully applied in history (checks both ID and Company+Title)
   */
  hasApplied(jobOrId, maybeCompany, maybeTitle) {
    if (!jobOrId) return false;
    const target = typeof jobOrId === 'object' ? jobOrId : {
      jobId: String(jobOrId),
      company: maybeCompany || '',
      title: maybeTitle || ''
    };

    return this.data.applications.some(
      app => (app.status === 'applied' || app.status === 'previously_applied') && this.isSameJob(app, target)
    );
  }

  /**
   * Find existing application entry in history for a job if one exists
   */
  findPriorApplication(jobOrId, maybeCompany, maybeTitle) {
    if (!jobOrId) return null;
    const target = typeof jobOrId === 'object' ? jobOrId : {
      jobId: String(jobOrId),
      company: maybeCompany || '',
      title: maybeTitle || ''
    };

    return this.data.applications.find(app => this.isSameJob(app, target)) || null;
  }

  /**
   * Check if a job was attempted previously in history (any status)
   */
  hasAttempted(jobOrId, maybeCompany, maybeTitle) {
    if (!jobOrId) return false;
    const target = typeof jobOrId === 'object' ? jobOrId : {
      jobId: String(jobOrId),
      company: maybeCompany || '',
      title: maybeTitle || ''
    };

    return this.data.applications.some(app => this.isSameJob(app, target));
  }

  /**
   * Deduplicate historical records in applications.json
   */
  deduplicateHistory() {
    if (!Array.isArray(this.data?.applications)) return;
    const unique = [];
    for (const app of this.data.applications) {
      const idx = unique.findIndex(u => this.isSameJob(u, app));
      if (idx === -1) {
        unique.push(app);
      } else {
        // Preference: applied (3) > previously_applied (2) > skipped/failed (1)
        const rank = s => (s === 'applied' ? 3 : (s === 'previously_applied' ? 2 : 1));
        if (rank(app.status) > rank(unique[idx].status)) {
          unique[idx] = app;
        }
      }
    }
    if (unique.length !== this.data.applications.length) {
      console.log(`[Tracker] Cleaned up ${this.data.applications.length - unique.length} duplicate entries from applications history.`);
      this.data.applications = unique;
      this.saveData();
    }
  }

  getTodayAppliedCount() {
    const today = this.getTodayDateString();
    return this.data.applications.filter(
      app => app.status === 'applied' &&
             !app.notes?.toLowerCase().includes('already applied') &&
             !app.notes?.toLowerCase().includes('detected from search history badge') &&
             app.appliedAt &&
             app.appliedAt.startsWith(today)
    ).length;
  }

  isDailyLimitReached(limit = 25) {
    return this.getTodayAppliedCount() >= limit;
  }

  record(app) {
    const isPreviouslyApplied = app.status === 'previously_applied' ||
      (app.notes && (
        app.notes.toLowerCase().includes('already applied') ||
        app.notes.toLowerCase().includes('detected from search history badge')
      ));
    const finalStatus = isPreviouslyApplied ? 'previously_applied' : (app.status || 'applied');

    let plat = app.platform;
    if (!plat) {
      if (app.url && app.url.includes('wellfound')) plat = 'wellfound';
      else if (app.url && app.url.includes('weworkremotely')) plat = 'weworkremotely';
      else if (app.url && app.url.includes('remoteok')) plat = 'remoteok';
      else if (app.url && app.url.includes('jobicy')) plat = 'jobicy';
      else if (app.url && (app.url.includes('greenhouse') || app.url.includes('lever') || app.url.includes('ashby'))) plat = 'remote_ats';
      else plat = 'linkedin';
    }

    const entry = {
      jobId: String(app.jobId || Date.now()),
      platform: plat,
      title: app.title || 'Unknown Title',
      company: app.company || 'Unknown Company',
      location: app.location || 'Unknown Location',
      url: app.url || '',
      status: finalStatus, // 'applied' | 'previously_applied' | 'skipped' | 'failed' | 'reviewed'
      appliedAt: isPreviouslyApplied ? null : (app.appliedAt || new Date().toISOString()),
      detectedAt: isPreviouslyApplied ? (app.detectedAt || new Date().toISOString()) : undefined,
      notes: app.notes || (isPreviouslyApplied ? 'Already applied on LinkedIn (detected from badge)' : ''),
      cvUsed: app.cvUsed || (app.notes && app.notes.includes('Tailored ATS CV:') ? app.notes.split('Tailored ATS CV:')[1].trim() : (isPreviouslyApplied ? 'LinkedIn Prior Application' : 'LinkedIn Default ATS Resume')),
      description: app.description || ''
    };

    // Remove any prior entry representing the same job
    this.data.applications = this.data.applications.filter(a => !this.isSameJob(a, entry));
    this.data.applications.unshift(entry);
    this.saveData();
    return entry;
  }

  getStats(limit = 25) {
    const todayCount = this.getTodayAppliedCount();
    const totalApplied = this.data.applications.filter(a => a.status === 'applied').length;
    const previouslyApplied = this.data.applications.filter(a => a.status === 'previously_applied').length;
    const skipped = this.data.applications.filter(a => a.status === 'skipped').length;
    const failed = this.data.applications.filter(a => a.status === 'failed').length;

    const isWWR = a => a.platform === 'weworkremotely' || (a.url && a.url.includes('weworkremotely'));
    const isRemoteOK = a => a.platform === 'remoteok' || (a.url && a.url.includes('remoteok'));
    const isJobicy = a => a.platform === 'jobicy' || (a.url && a.url.includes('jobicy'));
    const isCuratedATS = a => isWWR(a) || isRemoteOK(a) || isJobicy(a) || a.platform === 'remote_ats' || a.platform === 'greenhouse' || a.platform === 'lever' || a.platform === 'ashby';

    // Platform breakdown
    const byPlatform = {
      linkedin: this.data.applications.filter(a => (!a.platform || a.platform === 'linkedin') && a.status === 'applied').length,
      wellfound: this.data.applications.filter(a => a.platform === 'wellfound' && a.status === 'applied').length,
      weworkremotely: this.data.applications.filter(a => isWWR(a) && a.status === 'applied').length,
      remoteok: this.data.applications.filter(a => isRemoteOK(a) && a.status === 'applied').length,
      jobicy: this.data.applications.filter(a => isJobicy(a) && a.status === 'applied').length,
      remote_ats: this.data.applications.filter(a => isCuratedATS(a) && a.status === 'applied').length
    };

    return {
      todayApplied: todayCount,
      dailyLimit: limit,
      remainingToday: Math.max(0, limit - todayCount),
      totalApplied,
      previouslyApplied,
      skipped,
      failed,
      totalTracked: this.data.applications.length,
      byPlatform
    };
  }

  getAllApplications(platformFilter = 'all') {
    if (!platformFilter || platformFilter === 'all') {
      return this.data.applications;
    }
    const isWWR = a => a.platform === 'weworkremotely' || (a.url && a.url.includes('weworkremotely'));
    const isRemoteOK = a => a.platform === 'remoteok' || (a.url && a.url.includes('remoteok'));
    const isJobicy = a => a.platform === 'jobicy' || (a.url && a.url.includes('jobicy'));
    const isCuratedATS = a => isWWR(a) || isRemoteOK(a) || isJobicy(a) || a.platform === 'remote_ats' || a.platform === 'greenhouse' || a.platform === 'lever' || a.platform === 'ashby';

    return this.data.applications.filter(a => {
      const p = (a.platform || 'linkedin').toLowerCase();
      if (platformFilter === 'remote_ats') return isCuratedATS(a);
      if (platformFilter === 'weworkremotely') return isWWR(a);
      if (platformFilter === 'remoteok') return isRemoteOK(a);
      if (platformFilter === 'jobicy') return isJobicy(a);
      return p === platformFilter;
    });
  }

  /**
   * Pre-flight Status Classifier based on the 3-Tier Status Classes
   * @param {Object} job
   * @returns {{ action: 'PROCEED'|'SKIP', class: 'DONE'|'HOLD'|'COOLDOWN'|'CLEAR', reason: string, attemptsCount: number }}
   */
  evaluatePreFlightClass(job) {
    if (!job) return { action: 'PROCEED', class: 'CLEAR', attemptsCount: 0 };
    const prior = this.findPriorApplication(job);
    if (!prior) return { action: 'PROCEED', class: 'CLEAR', attemptsCount: 0 };

    const status = String(prior.status || '').toUpperCase();
    const attempts = prior.attemptsCount || 1;
    const now = Date.now();
    const lastDate = prior.appliedAt || prior.detectedAt || prior.timestamp ? new Date(prior.appliedAt || prior.detectedAt || prior.timestamp).getTime() : now;
    const daysSince = (now - lastDate) / (1000 * 60 * 60 * 24);

    // 1. DONE Class: Skip for 90 days
    if (status === 'APPLIED' || status === 'APPLIED_CONFIRMED' || status === 'PREVIOUSLY_APPLIED') {
      if (daysSince <= 90) {
        return { action: 'SKIP', class: 'DONE', reason: 'CODE_PREFLIGHT_ALREADY_APPLIED', attemptsCount: attempts };
      }
    }

    // 2. HOLD Class: Never retry automatically; user must clear
    const holdStatuses = [
      'UNVERIFIED_MANUAL_CHECK',
      'CANCELLED_BY_USER',
      'HANDED_OFF_TO_USER',
      'BLOCKED_SSO_ONLY',
      'BLOCKED_UNSUPPORTED_AUTH',
      'FAILED_MISSING_LEGAL_CONFIG',
      'FAILED_LEGAL_FIELD_REJECTED'
    ];
    if (holdStatuses.includes(status)) {
      return { action: 'SKIP', class: 'HOLD', reason: status, attemptsCount: attempts };
    }

    // 3. COOLDOWN Class: 7-day cooldown window, or promote to HOLD if attemptsCount >= 3
    const cooldownStatuses = [
      'BLOCKED_CAPTCHA',
      'BLOCKED_ACTIVATION_PENDING',
      'TIMEOUT_2FA',
      'TIMEOUT_USER_REVIEW',
      'FAILED_PORTAL_UNREACHABLE',
      'FAILED_GUEST_APPLY_LOAD',
      'FAILED_OAUTH_NO_FALLBACK',
      'FAILED_CREDENTIALS_REJECTED',
      'FAILED_AUTH_CYCLE',
      'FAILED_REG_POLICY',
      'FAILED_MASTER_PASSWORD_REJECTED',
      'FAILED_2FA_EXHAUSTED',
      'FAILED_POST_AUTH_FORM_LOST',
      'FAILED_RESUME_UPLOAD',
      'FAILED_SESSION_EXPIRED',
      'FAILED_WIZARD_CYCLIC_LOOP',
      'FAILED_WIZARD_NO_BUTTON',
      'FAILED_STEP_VALIDATION'
    ];

    if (cooldownStatuses.some(s => status.startsWith(s))) {
      if (attempts >= 3) {
        return { action: 'SKIP', class: 'HOLD', reason: 'CODE_MAX_ATTEMPTS_EXCEEDED', attemptsCount: attempts };
      }
      if (daysSince < 7) {
        return { action: 'SKIP', class: 'COOLDOWN', reason: `CODE_COOLDOWN_ACTIVE_${status}`, attemptsCount: attempts, daysLeft: Math.ceil(7 - daysSince) };
      }
      return { action: 'PROCEED', class: 'CLEAR', attemptsCount: attempts };
    }

    // 4. Safe Default for UNRECOGNIZED prior status: Default to HOLD (never accidentally clear/retry)
    return { action: 'SKIP', class: 'HOLD', reason: `CODE_UNKNOWN_STATUS_HOLD_${status}`, attemptsCount: attempts };
  }

  /**
   * Record structured outcome with explicit status classes, attempts, and audit metadata
   */
  recordOutcome(job, status, metadata = {}) {
    const prior = this.findPriorApplication(job);
    const attempts = (prior?.attemptsCount || 0) + 1;

    const entry = {
      jobId: String(job.jobId || Date.now()),
      platform: job.platform || 'external',
      title: job.title || 'Unknown Title',
      company: job.company || 'Unknown Company',
      location: job.location || 'Unknown Location',
      url: job.url || '',
      status: status, // APPLIED_CONFIRMED, UNVERIFIED_MANUAL_CHECK, BLOCKED_CAPTCHA, etc.
      stage: metadata.stage || undefined,
      code: metadata.code || status,
      attemptsCount: attempts,
      appliedAt: status === 'APPLIED_CONFIRMED' || status === 'applied' ? new Date().toISOString() : null,
      lastAttempt: new Date().toISOString(),
      notes: metadata.notes || metadata.message || '',
      cvUsed: metadata.cvUsed || job.tailoredCV || 'LinkedIn Default ATS Resume',
      description: job.description || ''
    };

    this.data.applications = this.data.applications.filter(a => !this.isSameJob(a, entry));
    this.data.applications.unshift(entry);
    this.saveData();
    return entry;
  }
}

module.exports = new Tracker();