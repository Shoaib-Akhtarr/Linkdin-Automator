const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');

class Tracker {
  constructor() {
    this.ensureDataFile();
    this.data = this.loadData();
    this.cleanDailyQuotaIfNeeded();
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

  hasApplied(jobId) {
    if (!jobId) return false;
    return this.data.applications.some(
      app => app.jobId === String(jobId) && app.status === 'applied'
    );
  }

  hasAttempted(jobId) {
    if (!jobId) return false;
    return this.data.applications.some(app => app.jobId === String(jobId));
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
      notes: app.notes || ''
    };

    // Remove old entry with same jobId if any
    this.data.applications = this.data.applications.filter(a => a.jobId !== entry.jobId);
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
