const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const browserBridge = require('./browserBridge');
const tracker = require('./tracker');
const SearchEngine = require('./searchEngine');
const EasyApplyModal = require('./easyApplyModal');
const ExternalApplyEngine = require('./externalApplyEngine');
const eligibilityEngine = require('./eligibilityEngine');

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'awaiting_review'
    this.searchEngine = new SearchEngine(browserBridge);
    this.easyApplyModal = new EasyApplyModal(browserBridge);
    this.externalApplyEngine = new ExternalApplyEngine(browserBridge);
    this.currentJob = null;
    this.reviewPromiseResolve = null;
    this.logs = [];
    this.settings = this.loadSettings();
  }

  loadSettings() {
    const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
    return {};
  }

  reloadSettings() {
    this.settings = this.loadSettings();
  }

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    this.logs.unshift(entry);
    if (this.logs.length > 300) this.logs.pop();
    this.emit('log', entry);
    console.log(`[${entry.timestamp}] [${type.toUpperCase()}] ${message}`);
  }

  async start() {
    if (this.state === 'running') {
      this.log('Automation is already running.', 'warn');
      return;
    }
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('state_change', this.state);
      this.log('Resumed automation loop.', 'info');
      return;
    }

    this.reloadSettings();
    this.state = 'running';
    this.emit('state_change', this.state);
    this.log('🚀 Starting LinkedIn Easy Apply Automation Engine...', 'info');

    // Run execution loop in background
    this.runLoop().catch(err => {
      this.log(`Critical error in execution loop: ${err.message}`, 'error');
      this.state = 'idle';
      this.emit('state_change', this.state);
    });
  }

  pause() {
    if (this.state === 'running' || this.state === 'awaiting_review') {
      this.state = 'paused';
      this.emit('state_change', this.state);
      this.log('⏸ Automation paused by user.', 'warn');
    }
  }

  stop() {
    this.state = 'stopped';
    this.emit('state_change', this.state);
    this.log('⏹ Automation stopped by user.', 'info');
    if (this.reviewPromiseResolve) {
      this.reviewPromiseResolve('skip');
      this.reviewPromiseResolve = null;
    }
    setTimeout(() => {
      this.state = 'idle';
      this.emit('state_change', this.state);
    }, 500);
  }

  /**
   * Action for Hybrid/Review mode when waiting for user review
   */
  async approveApplication() {
    if (this.state !== 'awaiting_review') return;
    this.log('✓ User approved application! Submitting...', 'success');
    if (this.reviewPromiseResolve) {
      this.reviewPromiseResolve('submit');
      this.reviewPromiseResolve = null;
    }
  }

  async skipCurrentApplication() {
    if (this.state !== 'awaiting_review') return;
    this.log('User skipped current application.', 'warn');
    if (this.reviewPromiseResolve) {
      this.reviewPromiseResolve('skip');
      this.reviewPromiseResolve = null;
    }
  }

  async runLoop() {
    try {
      this.log('Connecting to Google Chrome...', 'info');
      const page = await browserBridge.connect();

      this.log('Verifying LinkedIn login status...', 'info');
      const loggedIn = await browserBridge.isLinkedInLoggedIn();
      if (!loggedIn) {
        this.log(
          '⚠️ Please log in to LinkedIn in the opened Chrome window. The automation will continue once logged in.',
          'warn'
        );
        // Wait up to 2 minutes for user to log in
        let waited = 0;
        while (waited < 120 && !(await browserBridge.isLinkedInLoggedIn())) {
          await new Promise(r => setTimeout(r, 3000));
          waited += 3;
        }
        if (!(await browserBridge.isLinkedInLoggedIn())) {
          throw new Error('LinkedIn login timeout. Please log in to your account and restart.');
        }
      }
      this.log('✓ Successfully verified LinkedIn active session!', 'success');

      const keywords = this.settings.search?.keywords || ['AI Engineer'];
      const dailyLimit = this.settings.execution?.dailyApplicationLimit || 25;
      const mode = this.settings.execution?.mode || 'hybrid';
      const batchLimit = this.settings.autopilot?.batchSize || 10;
      let batchAppliedCount = 0;

      for (const keyword of keywords) {
        if (this.state === 'stopped') break;

        if (this.settings.autopilot?.enabled && batchAppliedCount >= batchLimit) {
          this.log(`🎯 Autopilot batch goal reached (${batchAppliedCount} jobs applied in this cycle). Cooldown initiated.`, 'success');
          break;
        }

        if (tracker.isDailyLimitReached(dailyLimit)) {
          this.log(`🎉 Daily application limit reached (${dailyLimit}). Stopping safely for today.`, 'success');
          break;
        }

        this.log(`🔍 Searching jobs for keyword: "${keyword}"...`, 'info');
        const jobs = await this.searchEngine.navigateToSearch(keyword, this.settings, msg => this.log(msg));

        this.log(`Found ${jobs.length} candidate Easy Apply listings for "${keyword}".`, 'info');

        for (const job of jobs) {
          if (this.state === 'stopped') break;

          while (this.state === 'paused') {
            await new Promise(r => setTimeout(r, 1000));
            if (this.state === 'stopped') break;
          }
          if (this.state === 'stopped') break;

          if (tracker.isDailyLimitReached(dailyLimit)) {
            this.log(`🎉 Daily application limit reached (${dailyLimit}). Stopping safely.`, 'success');
            break;
          }

          if (tracker.hasApplied(job.jobId)) {
            this.log(`Skipping already applied job: ${job.title} at ${job.company}`, 'info');
            continue;
          }

          this.currentJob = job;
          this.emit('current_job', job);
          this.log(`👉 Inspecting: "${job.title}" at "${job.company}" (${job.location})`, 'info');

          // Select job card & extract full description
          const selected = await this.searchEngine.selectJob(page, job, msg => this.log(msg));
          if (!selected) {
            this.log(`Could not load details for ${job.title}, skipping.`, 'warn');
            continue;
          }

          // Intellisense Pre-Filter & JD Analysis
          const eligibility = eligibilityEngine.evaluateEligibility(job, this.settings);
          if (!eligibility.eligible) {
            this.log(`🛡️ Pre-filter: Skipped "${job.title}" at "${job.company}" (${eligibility.reason})`, 'warn');
            tracker.record({ ...job, status: 'skipped', notes: `Pre-filtered: ${eligibility.reason}` });
            this.emit('stats_update', tracker.getStats(dailyLimit));
            continue;
          }

          if (eligibility.matchedSkills.length > 0) {
            this.log(`💡 JD Intelligence (${eligibility.matchedSkills.length} skills): ${eligibility.matchedSkills.slice(0, 5).join(', ')} | Match: ${eligibility.matchScore}%`, 'info');
          }

          // Check for Apply buttons (Easy Apply vs External Apply)
          const detected = await this.searchEngine.detectApplyButton(page, msg => this.log(msg));
          if (detected.type === 'already_applied') {
            tracker.record({ ...job, status: 'applied', notes: 'Already applied on LinkedIn' });
            this.emit('stats_update', tracker.getStats(dailyLimit));
            continue;
          }

          if (detected.type === 'none') {
            this.log(`No direct or external Apply button found on "${job.title}", skipping.`, 'info');
            tracker.record({ ...job, status: 'skipped', notes: 'No Apply button found' });
            continue;
          }

          const allowExternal = this.settings.search?.easyApplyOnly === false || this.settings.search?.applyType === 'all';
          let result = null;
          let isExternal = false;
          let externalPageRef = null;

          if (detected.type === 'easy_apply') {
            this.log('Triggering LinkedIn Easy Apply modal...', 'info');
            await detected.element.click({ force: true });
            await browserBridge.humanDelay(1200, 2000);

            const screenshot = await browserBridge.takeScreenshot();
            if (screenshot) this.emit('screenshot', screenshot);

            result = await this.easyApplyModal.handleModal(job, {
              mode,
              settings: this.settings,
              onStatusUpdate: msg => this.log(msg)
            });
          } else if (detected.type === 'external_apply') {
            if (!allowExternal) {
              this.log(`External company listing found, but "Easy Apply Only" is active in settings. Skipping.`, 'info');
              tracker.record({ ...job, status: 'skipped', notes: 'External apply skipped (Easy Apply Only setting)' });
              continue;
            }

            isExternal = true;
            this.log(`🌐 Universal External Apply: Initiating application for "${job.title}" at "${job.company}"...`, 'info');
            result = await this.externalApplyEngine.handleExternalApply(page, job, {
              mode,
              settings: this.settings,
              onStatusUpdate: msg => this.log(msg)
            });
            if (result && result.page) {
              externalPageRef = result.page;
            }
          }

          const cvNote = job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : '';

          if (result && result.status === 'needs_review') {
            this.state = 'awaiting_review';
            this.emit('state_change', this.state);
            const reviewScreenshot = await browserBridge.takeScreenshot();
            if (reviewScreenshot) this.emit('screenshot', reviewScreenshot);

            // Wait for user review decision
            const decision = await new Promise(resolve => {
              this.reviewPromiseResolve = resolve;
            });

            if (decision === 'submit') {
              if (isExternal && externalPageRef) {
                // Submit external form
                const extSubmit = await externalPageRef.$('button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")');
                if (extSubmit) await extSubmit.click({ force: true });
                await browserBridge.humanDelay(2500, 4000);
                await externalPageRef.close().catch(() => {});
              } else {
                // Click submit in LinkedIn modal
                const submitBtn = await page.$(
                  'dialog button:has-text("Submit application"), dialog button:has-text("Submit"), [data-testid="dialog"] button:has-text("Submit"), button[aria-label*="Submit application"], button:has-text("Submit application"), button:has-text("Submit")'
                );
                if (submitBtn) {
                  await submitBtn.click({ force: true });
                  await browserBridge.humanDelay(2500, 4000);
                  await this.easyApplyModal.closeSuccessModal(page, msg => this.log(msg));
                }
              }
              tracker.record({ ...job, status: 'applied', notes: cvNote || 'Approved and submitted by user' });
              this.log(`✓ Successfully submitted application for ${job.title} at ${job.company}!`, 'success');
              batchAppliedCount++;
            } else {
              // Dismiss / close
              if (isExternal && externalPageRef) {
                await externalPageRef.close().catch(() => {});
              } else {
                await this.easyApplyModal.dismissModal(page);
              }
              tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
              this.log(`Application skipped for ${job.title}.`, 'warn');
            }

            this.state = 'running';
            this.emit('state_change', this.state);
          } else if (result && result.status === 'applied') {
            if (isExternal && externalPageRef) {
              await externalPageRef.close().catch(() => {});
            }
            tracker.record({ ...job, status: 'applied', notes: cvNote || result.message });
            this.log(`✓ Successfully applied to ${job.title} at ${job.company}!`, 'success');
            batchAppliedCount++;
          } else {
            if (isExternal && externalPageRef) {
              await externalPageRef.close().catch(() => {});
            } else {
              await this.easyApplyModal.dismissModal(page);
            }
            const errMsg = result?.message || 'Unknown error';
            tracker.record({ ...job, status: 'failed', notes: errMsg });
            this.log(`Could not complete application for ${job.title}: ${errMsg}`, 'warn');
          }

          this.emit('stats_update', tracker.getStats(dailyLimit));
          this.currentJob = null;
          this.emit('current_job', null);

          // Check if batch limit is reached mid-keyword
          if (this.settings.autopilot?.enabled && batchAppliedCount >= batchLimit) {
            this.log(`🎯 Autopilot batch goal reached (${batchAppliedCount} jobs applied in this cycle). Entering cooldown.`, 'success');
            break;
          }

          // Human randomized cooldown between job applications
          const delay = Math.floor(Math.random() * 3000) + 3000;
          this.log(`Taking a natural ${Math.round(delay / 1000)}s rest before next listing...`, 'info');
          await new Promise(r => setTimeout(r, delay));
        }
      }

      this.log('🏁 Search cycle finished. Engine idle.', 'info');
    } catch (err) {
      this.log(`Loop error: ${err.message}`, 'error');
    } finally {
      this.state = 'idle';
      this.currentJob = null;
      this.emit('state_change', this.state);
      this.emit('current_job', null);
      this.emit('cycle_finished', { batchAppliedCount });
    }
  }

  getStatus() {
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 25;
    return {
      state: this.state,
      currentJob: this.currentJob,
      stats: tracker.getStats(dailyLimit),
      logs: this.logs.slice(0, 100)
    };
  }
}

module.exports = new Orchestrator();
