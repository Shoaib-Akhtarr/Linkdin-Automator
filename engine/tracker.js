const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');

class Tracker {
  constructor() {
    this.ensureDataFile();
    this.data = this.loadData();
    this.cleanDailyQuotaIfNeeded();
    this.deduplicateHistory();
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
      app => app.status === 'applied' && this.isSameJob(app, target)
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
        // Upgrade to 'applied' if previously skipped/failed
        if (unique[idx].status !== 'applied' && app.status === 'applied') {
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
      app => app.status === 'applied' && app.appliedAt && app.appliedAt.startsWith(today)
    ).length;
  }

  isDailyLimitReached(limit = 25) {
    return this.getTodayAppliedCount() >= limit;
  }

  record(app) {
    const entry = {
      jobId: String(app.jobId || Date.now()),
      title: app.title || 'Unknown Title',
      company: app.company || 'Unknown Company',
      location: app.location || 'Unknown Location',
      url: app.url || '',
      status: app.status || 'applied', // 'applied' | 'skipped' | 'failed' | 'reviewed'
      appliedAt: new Date().toISOString(),
      notes: app.notes || '',
      cvUsed: app.cvUsed || (app.notes && app.notes.includes('Tailored ATS CV:') ? app.notes.split('Tailored ATS CV:')[1].trim() : 'LinkedIn Default ATS Resume'),
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
    const skipped = this.data.applications.filter(a => a.status === 'skipped').length;
    const failed = this.data.applications.filter(a => a.status === 'failed').length;

    return {
      todayApplied: todayCount,
      dailyLimit: limit,
      remainingToday: Math.max(0, limit - todayCount),
      totalApplied,
      skipped,
      failed,
      totalTracked: this.data.applications.length
    };
  }

  getAllApplications() {
    return this.data.applications;
  }
}

module.exports = new Tracker();
