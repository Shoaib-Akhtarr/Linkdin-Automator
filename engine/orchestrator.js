const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const browserBridge = require('./browserBridge');
const tracker = require('./tracker');
const SearchEngine = require('./searchEngine');
const EasyApplyModal = require('./easyApplyModal');
const ExternalApplyEngine = require('./externalApplyEngine');
const eligibilityEngine = require('./eligibilityEngine');
const RemoteBoardsEngine = require('./platforms/remoteBoardsEngine');
const WellfoundEngine = require('./platforms/wellfoundEngine');
const CompanyAtsEngine = require('./platforms/companyAtsEngine');

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'awaiting_review'
    this.isStopped = false;
    this.activeLoopPromise = null;
    this.searchEngine = new SearchEngine(browserBridge);
    this.easyApplyModal = new EasyApplyModal(browserBridge);
    this.externalApplyEngine = new ExternalApplyEngine(browserBridge);
    this.remoteBoardsEngine = new RemoteBoardsEngine(browserBridge, this.externalApplyEngine);
    this.wellfoundEngine = new WellfoundEngine(browserBridge);
    this.companyAtsEngine = new CompanyAtsEngine(browserBridge, this.externalApplyEngine);
    this.currentJob = null;
    this.reviewPromiseResolve = null;
    this.logs = [];
    this.settings = this.loadSettings();

    // Session tracking for reporting & continuous runs
    this.sessionAppliedJobs = [];
    this.sessionStartTime = null;
    this.reportSentForSession = false;
    this.easyApplyLimitReached = false;
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

  async interruptibleDelay(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (this.isStopped || this.state === 'stopped') break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async start() {
    if (this.state === 'running' || this.activeLoopPromise) {
      this.log('Automation is currently active or stopping. Please wait a second before starting.', 'warn');
      return;
    }
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('state_change', this.state);
      this.log('Resumed automation loop.', 'info');
      return;
    }

    this.isStopped = false;
    this.reloadSettings();
    this.state = 'running';
    this.emit('state_change', this.state);
    const activePlatform = (this.settings.activePlatform || 'all').toUpperCase();
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    this.log(`🚀 Starting Continuous Automation Engine (Target: ${activePlatform} | Daily Target: ${dailyLimit})...`, 'info');

    // Run execution loop in background with concurrency lock
    this.activeLoopPromise = this.runLoop().catch(err => {
      this.log(`Critical error in execution loop: ${err.message}`, 'error');
    });
  }

  pause() {
    if (this.state === 'running' || this.state === 'awaiting_review') {
      this.state = 'paused';
      this.emit('state_change', this.state);
      this.log('⏸ Automation paused by user.', 'warn');
    }
  }

  async stop() {
    if (this.isStopped && this.state === 'stopped') return;
    this.isStopped = true;
    this.state = 'stopped';
    this.emit('state_change', this.state);
    this.log('⏹ Automation stopped by user. Generating and sending session summary email...', 'warn');

    if (this.reviewPromiseResolve) {
      this.reviewPromiseResolve('skip');
      this.reviewPromiseResolve = null;
    }

    // Immediately trigger email report when user clicks Stop!
    try {
      await this.sendEmailReport(true);
    } catch (err) {
      this.log(`Failed to send stop email: ${err.message}`, 'error');
    }
  }

  /**
   * Dispatches the session email report cleanly without duplicates
   */
  async sendEmailReport(isManualStop = false) {
    if (this.reportSentForSession) return;
    this.reportSentForSession = true;

    try {
      const emailNotifier = require('./emailNotifier');
      const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
      const stats = tracker.getStats(dailyLimit);
      const appliedCount = this.sessionAppliedJobs.length;

      this.log(`📧 Dispatching ${isManualStop ? 'Stop' : 'Session'} Email Report (${appliedCount} jobs applied in this session)...`, 'info');

      await emailNotifier.sendReport({
        cycleTime: new Date().toLocaleString(),
        isManualStop,
        sessionStartTime: this.sessionStartTime ? this.sessionStartTime.toLocaleTimeString() : null,
        batchApplied: appliedCount,
        batchSkipped: stats.skipped,
        totalAppliedToday: stats.todayApplied,
        dailyLimit,
        appliedJobs: [...this.sessionAppliedJobs]
      });
      this.log('✓ Email report delivered successfully!', 'success');
    } catch (err) {
      this.log(`❌ Failed to send email report: ${err.message}`, 'error');
    }
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

  isLimitReached(batchAppliedCount) {
    if (this.state === 'stopped' || this.isStopped) return true;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const batchLimit = this.settings.autopilot?.batchSize || 10;
    if (tracker.isDailyLimitReached(dailyLimit)) {
      this.log(`🎉 Daily application limit reached (${dailyLimit}). Stopping safely for today.`, 'success');
      return true;
    }
    if (this.settings.autopilot?.enabled && batchAppliedCount >= batchLimit) {
      this.log(`🎯 Autopilot batch goal reached (${batchAppliedCount} jobs applied in this cycle). Entering cooldown.`, 'success');
      return true;
    }
    return false;
  }

  async runLoop() {
    this.sessionAppliedJobs = [];
    this.sessionStartTime = new Date();
    this.reportSentForSession = false;
    this.easyApplyLimitReached = false;
    let totalSessionApplied = 0;

    try {
      this.log('Connecting to Google Chrome...', 'info');
      let page = await browserBridge.connect();

      const activePlatform = (this.settings.activePlatform || 'all').toLowerCase();
      const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
      this.log(`🎯 Active Execution Target: ${activePlatform.toUpperCase()} (Daily Limit: ${dailyLimit})`, 'info');

      let round = 1;

      // CONTINUOUS LOOP: Keeps searching and applying until daily target is met or user clicks Stop
      while (!this.isStopped && !this.isLimitReached(totalSessionApplied)) {
        this.log(`🚀 [Round ${round}] Starting comprehensive application sweep across platforms...`, 'info');
        let roundAppliedCount = 0;

        // 0. Direct Company ATS Scan & Autonomous Apply (Ashby, Greenhouse, Lever)
        if (!this.isStopped && (this.settings.directCompanyAts?.enabled !== false)) {
          try {
            this.log('🔍 [Direct Company ATS] Sourcing verified company career listings via ATS endpoints...', 'info');
            await this.companyAtsEngine.scanAllCompanies(this.settings, msg => this.log(msg, 'info'));

            // If autoApply is active, auto-apply to eligible queued roles
            if (this.settings.directCompanyAts?.autoApply !== false && !this.isLimitReached(totalSessionApplied)) {
              const count = await this.runDirectCompanyAtsLoop(page, totalSessionApplied);
              roundAppliedCount += count;
              totalSessionApplied += count;
            }
          } catch (atsScanErr) {
            this.log(`⚠️ Direct ATS note: ${atsScanErr.message}`, 'warn');
          }
        }

        // 1. Curated Remote ATS Loop (WeWorkRemotely, RemoteOK, Jobicy, Greenhouse, Lever, Ashby)
        if (!this.isStopped && (activePlatform === 'all' || activePlatform === 'remote_ats' || activePlatform === 'weworkremotely' || activePlatform === 'remoteok' || activePlatform === 'jobicy')) {
          if (!this.isLimitReached(totalSessionApplied)) {
            try {
              const count = await this.runRemoteBoardsLoop(page, totalSessionApplied);
              roundAppliedCount += count;
              totalSessionApplied += count;
            } catch (atsErr) {
              this.log(`⚠️ Remote ATS sweep error: ${atsErr.message}. Continuing...`, 'warn');
            }
          }
        }

        // 2. Wellfound Startup Loop (AngelList)
        if (!this.isStopped && (activePlatform === 'all' || activePlatform === 'wellfound')) {
          if (!this.isLimitReached(totalSessionApplied)) {
            try {
              const count = await this.runWellfoundLoop(page, totalSessionApplied);
              roundAppliedCount += count;
              totalSessionApplied += count;
            } catch (wfErr) {
              this.log(`⚠️ Wellfound sweep error: ${wfErr.message}. Continuing...`, 'warn');
            }
          }
        }

        // 3. LinkedIn Loop (Easy Apply + Universal External)
        if (!this.isStopped && (activePlatform === 'all' || activePlatform === 'linkedin')) {
          if (!this.isLimitReached(totalSessionApplied)) {
            try {
              const count = await this.runLinkedInLoop(page, totalSessionApplied, round);
              roundAppliedCount += count;
              totalSessionApplied += count;
            } catch (liErr) {
              this.log(`⚠️ LinkedIn sweep error: ${liErr.message}. Continuing...`, 'warn');
            }
          }
        }

        // Check stopping conditions
        if (this.isStopped) {
          this.log('⏹ Loop cancelled safely by user.', 'info');
          break;
        }

        if (this.isLimitReached(totalSessionApplied)) {
          this.log(`🎉 Daily limit reached (${totalSessionApplied} applied in this session).`, 'success');
          break;
        }

        // If autopilot is enabled and batch size reached, autopilot scheduler handles cooldown
        if (this.settings.autopilot?.enabled && totalSessionApplied >= (this.settings.autopilot?.batchSize || 10)) {
          break;
        }

        const stats = tracker.getStats(dailyLimit);
        if (stats.todayApplied >= dailyLimit) {
          this.log(`🎉 Daily application limit reached (${stats.todayApplied}/${dailyLimit} applied today). Automation complete for today!`, 'success');
          break;
        }

        // If not at daily limit, rest briefly and start next round to sweep fresh listings
        round++;
        const restSeconds = roundAppliedCount > 0 ? 90 : 180; // 1.5 - 3 min rest
        this.log(`⏳ Round ${round - 1} complete. Today's progress: ${stats.todayApplied}/${dailyLimit} applied. Taking a natural ${restSeconds}s rest before sweeping next listings...`, 'info');
        await this.interruptibleDelay(restSeconds * 1000);
      }

    } catch (err) {
      this.log(`Critical loop error: ${err.message}`, 'error');
    } finally {
      const finalCount = this.sessionAppliedJobs.length;
      if (!this.reportSentForSession) {
        await this.sendEmailReport(this.isStopped);
      }
      this.isStopped = false;
      this.state = 'idle';
      this.currentJob = null;
      this.activeLoopPromise = null;
      this.emit('state_change', this.state);
      this.emit('current_job', null);
      this.emit('cycle_finished', { batchAppliedCount: finalCount });
    }
  }

  /**
   * Direct Company ATS Autonomous Apply Loop (Greenhouse, Lever, Ashby)
   */
  async runDirectCompanyAtsLoop(page, currentBatch) {
    let count = 0;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);

    const atsData = this.companyAtsEngine.loadAtsJobs();
    const queuedJobs = (atsData.jobs || []).filter(j => 
      j.status === 'auto_queued_for_apply' || j.status === 'approved_queued_for_apply'
    );

    if (queuedJobs.length === 0) {
      return 0;
    }

    this.log(`⚡ [Direct Company ATS] Found ${queuedJobs.length} queued matching role(s). Executing autonomous applications...`, 'info');

    for (const job of queuedJobs) {
      if (maxPerCat > 0 && count >= maxPerCat) {
        this.log(`🎯 Reached category quota (${count}/${maxPerCat}) for Direct Company ATS.`, 'info');
        break;
      }
      if (this.isLimitReached(currentBatch + count)) break;

      while (this.state === 'paused') {
        await new Promise(r => setTimeout(r, 1000));
        if (this.state === 'stopped' || this.isStopped) break;
      }
      if (this.state === 'stopped' || this.isStopped) break;

      try {
        const priorApp = tracker.findPriorApplication(job);
        if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
          job.status = 'applied';
          this.companyAtsEngine.saveAtsJobs(atsData);
          continue;
        }

        this.currentJob = job;
        this.emit('current_job', job);
        this.log(`👉 [Direct ATS Auto-Apply] Applying autonomously: "${job.title}" at "${job.company}" (${job.platform.toUpperCase()})`, 'info');

        try {
          if (!page || page.isClosed()) {
            page = await browserBridge.getPage();
          }
        } catch (_) {
          page = await browserBridge.getPage();
        }

        const result = await this.companyAtsEngine.approveAndApply(job.jobId, page, {
          mode: 'autonomous',
          settings: this.settings,
          onStatusUpdate: msg => this.log(msg)
        });

        if (result && result.status === 'applied') {
          const entry = tracker.record({
            ...job,
            status: 'applied',
            notes: job.tailoredCV ? `Direct ATS Tailored CV: ${job.tailoredCV}` : (result.message || 'Direct ATS Auto-Applied')
          });
          this.sessionAppliedJobs.push(entry);
          count++;
          this.log(`✓ Successfully auto-applied to "${job.title}" at "${job.company}" on ${job.platform.toUpperCase()}!`, 'success');
        } else if (result && result.status === 'needs_user_login') {
          this.log(`⚠️ Workday/Taleo auth required for "${job.title}" at "${job.company}". CV saved in data/tailored_cvs/.`, 'warn');
        } else {
          this.log(`⚠️ Auto-apply attempt completed with status: ${result?.status || 'skipped'} (${result?.message || 'form not submitted'})`, 'warn');
        }

        this.emit('stats_update', tracker.getStats(dailyLimit));
        this.currentJob = null;
        this.emit('current_job', null);

        const delay = Math.floor(Math.random() * 2500) + 2500;
        await this.interruptibleDelay(delay);
      } catch (jobErr) {
        this.log(`⚠️ Note on direct ATS "${job.title}": ${jobErr.message}. Continuing...`, 'warn');
      }
    }

    return count;
  }

  /**
   * Curated Remote ATS Loop (Greenhouse, Lever, Ashby via direct public feeds)
   */
  async runRemoteBoardsLoop(page, currentBatch) {
    let count = 0;
    let alreadyAppliedCount = 0;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);

    this.log('⚡ [Curated Remote ATS] Sourcing fresh remote developer/AI listings...', 'info');
    let jobs = [];
    try {
      jobs = await this.remoteBoardsEngine.searchJobs(this.settings, msg => this.log(msg));
    } catch (e) {
      this.log(`Remote ATS search note: ${e.message}`, 'warn');
      return 0;
    }

    for (const job of jobs) {
      if (maxPerCat > 0 && count >= maxPerCat) {
        this.log(`🎯 Reached category quota (${count}/${maxPerCat}) for Curated Remote ATS.`, 'info');
        break;
      }
      if (this.isLimitReached(currentBatch + count)) break;

      while (this.state === 'paused') {
        await new Promise(r => setTimeout(r, 1000));
        if (this.state === 'stopped' || this.isStopped) break;
      }
      if (this.state === 'stopped' || this.isStopped) break;

      try {
        // History checkpoint
        const priorApp = tracker.findPriorApplication(job);
        if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
          alreadyAppliedCount++;
          continue;
        }

        this.currentJob = job;
        this.emit('current_job', job);
        this.log(`👉 [Remote ATS] Inspecting: "${job.title}" at "${job.company}"`, 'info');

        // Pre-filter
        const eligibility = eligibilityEngine.evaluateEligibility(job, this.settings);
        if (!eligibility.eligible) {
          this.log(`🛡️ Pre-filter: Skipped "${job.title}" (${eligibility.reason})`, 'warn');
          tracker.record({ ...job, status: 'skipped', notes: `Pre-filtered: ${eligibility.reason}` });
          this.emit('stats_update', tracker.getStats(dailyLimit));
          continue;
        }

        try {
          if (!page || page.isClosed()) {
            this.log('🔄 Re-acquiring active Chrome page reference...', 'info');
            page = await browserBridge.getPage();
          }
        } catch (pErr) {
          page = await browserBridge.getPage();
        }

        const result = await this.remoteBoardsEngine.applyJob(page, job, {
          mode: this.settings.execution?.externalMode || this.settings.execution?.mode || 'autonomous',
          settings: this.settings,
          onStatusUpdate: msg => this.log(msg)
        });

        if (result && result.status === 'needs_review') {
          this.state = 'awaiting_review';
          this.emit('state_change', this.state);
          const screenshot = await browserBridge.takeScreenshot();
          if (screenshot) this.emit('screenshot', screenshot);

          const decision = await new Promise(resolve => { this.reviewPromiseResolve = resolve; });
          if (decision === 'submit') {
            const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved by user' });
            this.sessionAppliedJobs.push(entry);
            count++;
            this.log(`✓ Submitted application for "${job.title}" at "${job.company}"!`, 'success');
          } else {
            tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
          }
          this.state = 'running';
          this.emit('state_change', this.state);
        } else if (result && result.status === 'applied') {
          const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : result.message });
          this.sessionAppliedJobs.push(entry);
          count++;
          this.log(`✓ Successfully applied to "${job.title}" at "${job.company}" via Curated Remote ATS!`, 'success');
        } else {
          tracker.record({ ...job, status: 'failed', notes: result?.message || 'Failed' });
        }

        this.emit('stats_update', tracker.getStats(dailyLimit));
        this.currentJob = null;
        this.emit('current_job', null);

        const delay = Math.floor(Math.random() * 2500) + 2500;
        await this.interruptibleDelay(delay);
      } catch (jobErr) {
        this.log(`⚠️ Note on "${job.title}": ${jobErr.message}. Continuing...`, 'warn');
        tracker.record({ ...job, status: 'failed', notes: jobErr.message });
      }
    }

    const activeTarget = (this.settings.activePlatform || 'remote_ats').toUpperCase();
    if (jobs.length === 0) {
      this.log(`ℹ️ [Remote ATS] No new matching listings found on ${activeTarget} for configured keywords.`, 'info');
    } else if (alreadyAppliedCount > 0 && count === 0) {
      this.log(`ℹ️ [Remote ATS] Sourced ${jobs.length} roles on ${activeTarget}. All ${alreadyAppliedCount} matching candidate role(s) were already applied to previously in your tracker.`, 'info');
    }

    return count;
  }

  /**
   * Wellfound Startup Loop (AngelList)
   */
  async runWellfoundLoop(page, currentBatch) {
    let appliedCount = 0;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);
    const keywords = this.settings.search?.keywords || ['AI Engineer'];

    this.log('🚀 [Wellfound] Connecting to startup jobs stream...', 'info');
    let isLogged = await this.wellfoundEngine.isLoggedIn(page);
    if (!isLogged) {
      this.log('⚠️ Please log in to Wellfound in the opened Chrome window. The automation will continue once logged in (waiting up to 120s)...', 'warn');
      let waited = 0;
      while (waited < 120) {
        await new Promise(r => setTimeout(r, 3000));
        waited += 3;
        if (this.state === 'stopped' || this.isStopped) return 0;
        isLogged = await this.wellfoundEngine.isLoggedIn(page);
        if (isLogged) break;
      }
      if (!isLogged) {
        this.log('⚠️ Wellfound login timed out (120s). Skipping Wellfound for this cycle.', 'warn');
        return 0;
      }
    }
    this.log('✓ Successfully verified Wellfound active session!', 'success');

    for (const keyword of keywords) {
      if (this.isLimitReached(currentBatch + appliedCount)) break;

      this.log(`🔍 [Wellfound] Searching startup roles for: "${keyword}"...`, 'info');
      let jobs = [];
      try {
        jobs = await this.wellfoundEngine.searchJobs(page, keyword, this.settings, msg => this.log(msg));
      } catch (e) {
        this.log(`Wellfound search error for "${keyword}": ${e.message}`, 'warn');
        continue;
      }

      for (const job of jobs) {
        if (maxPerCat > 0 && appliedCount >= maxPerCat) {
          this.log(`🎯 Reached category quota (${appliedCount}/${maxPerCat}) for Wellfound.`, 'info');
          break;
        }
        if (this.isLimitReached(currentBatch + appliedCount)) break;

        while (this.state === 'paused') {
          await new Promise(r => setTimeout(r, 1000));
          if (this.state === 'stopped' || this.isStopped) break;
        }
        if (this.state === 'stopped' || this.isStopped) break;

        try {
          const priorApp = tracker.findPriorApplication(job);
          if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
            continue;
          }

          this.currentJob = job;
          this.emit('current_job', job);
          this.log(`👉 [Wellfound] Reviewing: "${job.title}" at "${job.company}"`, 'info');

          try {
            if (!page || page.isClosed()) {
              this.log('🔄 Re-acquiring active Chrome page reference...', 'info');
              page = await browserBridge.getPage();
            }
          } catch (pErr) {
            page = await browserBridge.getPage();
          }

          const result = await this.wellfoundEngine.applyJob(page, job, {
            mode: this.settings.execution?.mode || 'autonomous',
            settings: this.settings,
            onStatusUpdate: msg => this.log(msg),
            onScreenshot: ss => this.emit('screenshot', ss)
          });

          if (result && result.status === 'needs_review') {
            this.state = 'awaiting_review';
            this.emit('state_change', this.state);
            const decision = await new Promise(r => { this.reviewPromiseResolve = r; });
            if (decision === 'submit') {
              const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved by user' });
              this.sessionAppliedJobs.push(entry);
              appliedCount++;
              this.log(`✓ Submitted Wellfound application for ${job.title}!`, 'success');
            } else {
              tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
            }
            this.state = 'running';
            this.emit('state_change', this.state);
          } else if (result && result.status === 'applied') {
            const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : result.message });
            this.sessionAppliedJobs.push(entry);
            appliedCount++;
            this.log(`✓ Successfully applied to "${job.title}" at "${job.company}" on Wellfound!`, 'success');
          } else if (result && result.status === 'previously_applied') {
            tracker.record({ ...job, status: 'previously_applied', notes: result.message });
            this.log(`🛡️ Already applied to "${job.title}" on Wellfound.`, 'info');
          } else if (result && result.status === 'skipped') {
            tracker.record({ ...job, status: 'skipped', notes: result.message });
            this.log(`⏭️ Skipped "${job.title}": ${result.message}`, 'warn');
          } else {
            tracker.record({ ...job, status: 'failed', notes: result?.message || 'Failed' });
            this.log(`⚠️ Application to "${job.title}" could not be completed: ${result?.message || 'Unknown error'}`, 'warn');
          }

          this.emit('stats_update', tracker.getStats(dailyLimit));
          this.currentJob = null;
          this.emit('current_job', null);

          const delay = Math.floor(Math.random() * 2500) + 2500;
          await this.interruptibleDelay(delay);
        } catch (jobErr) {
          this.log(`⚠️ Note on "${job.title}": ${jobErr.message}. Continuing...`, 'warn');
          tracker.record({ ...job, status: 'failed', notes: jobErr.message });
        }
      }
    }
    return appliedCount;
  }

  /**
   * LinkedIn Loop (Easy Apply + Universal External)
   */
  async runLinkedInLoop(page, currentBatch, round = 1) {
    let batchAppliedCount = 0;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);
    this.log('Verifying LinkedIn login status...', 'info');
    try {
      page = await browserBridge.getPage();
      if (browserBridge.context) {
        const pages = browserBridge.context.pages().filter(p => !p.isClosed());
        const liPage = pages.find(p => p.url().includes('linkedin.com'));
        if (liPage) {
          page = liPage;
          browserBridge.page = liPage;
        }
      }
    } catch (_) {}
    const loggedIn = await browserBridge.isLinkedInLoggedIn();
    if (!loggedIn) {
      this.log(
        '⚠️ Please log in to LinkedIn in the opened Chrome window. The automation will continue once logged in.',
        'warn'
      );
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

    let keywords = this.settings.search?.keywords || ['AI Engineer'];
    // On subsequent rounds, rotate keywords so earlier ones don't monopolize
    if (round > 1 && keywords.length > 1) {
      const shiftCount = (round - 1) % keywords.length;
      keywords = [...keywords.slice(shiftCount), ...keywords.slice(0, shiftCount)];
    }

    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const mode = this.settings.execution?.mode || 'hybrid';

    for (const keyword of keywords) {
      if (this.isStopped || this.isLimitReached(currentBatch + batchAppliedCount)) break;
      if (maxPerCat > 0 && batchAppliedCount >= maxPerCat) break;

      this.log(`🔍 Searching LinkedIn jobs for keyword: "${keyword}"...`, 'info');
      let jobs = [];
      try {
        jobs = await this.searchEngine.navigateToSearch(keyword, this.settings, msg => this.log(msg));
      } catch (e) {
        this.log(`Navigation note for "${keyword}": ${e.message}`, 'warn');
        continue;
      }

      this.log(`Found ${jobs.length} candidate listings for "${keyword}".`, 'info');

      for (const job of jobs) {
        if (maxPerCat > 0 && batchAppliedCount >= maxPerCat) {
          this.log(`🎯 Reached category quota (${batchAppliedCount}/${maxPerCat}) for LinkedIn.`, 'info');
          break;
        }
        if (this.isLimitReached(currentBatch + batchAppliedCount)) break;

        while (this.state === 'paused') {
          await new Promise(r => setTimeout(r, 1000));
          if (this.state === 'stopped' || this.isStopped) break;
        }
        if (this.state === 'stopped' || this.isStopped) break;

        // SAFE PER-JOB EXECUTION: If any error occurs on this job, log and continue smoothly!
        try {
          // History checkpoint
          const priorApp = tracker.findPriorApplication(job);
          if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
            const appliedDate = priorApp.appliedAt ? priorApp.appliedAt.split('T')[0] : 'previously';
            this.log(`⏭️ History checkpoint: Skipping already applied job: "${job.title}" at "${job.company}" (Applied ${appliedDate})`, 'info');
            continue;
          }

          this.currentJob = job;
          this.emit('current_job', job);
          this.log(`👉 Inspecting: "${job.title}" at "${job.company}" (${job.location})`, 'info');

          try {
            if (!page || page.isClosed()) {
              this.log('🔄 Re-acquiring active LinkedIn page reference...', 'info');
              page = await browserBridge.getPage();
            }
          } catch (pErr) {
            page = await browserBridge.getPage();
          }

          const selected = await this.searchEngine.selectJob(page, job, msg => this.log(msg));
          if (!selected) {
            this.log(`Could not load details for ${job.title}, skipping.`, 'warn');
            continue;
          }

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

          const detected = await this.searchEngine.detectApplyButton(page, msg => this.log(msg));
          if (detected.type === 'already_applied') {
            this.log(`✓ LinkedIn confirms already applied for "${job.title}" at "${job.company}". Updating history and skipping.`, 'info');
            tracker.record({ ...job, status: 'previously_applied', notes: detected.message || 'Already applied on LinkedIn' });
            this.emit('stats_update', tracker.getStats(dailyLimit));
            continue;
          }

          if (detected.type === 'none') {
            this.log(`No direct or external Apply button found on "${job.title}", skipping.`, 'info');
            tracker.record({ ...job, status: 'skipped', notes: 'No Apply button found' });
            continue;
          }

          // If Easy Apply is capped by LinkedIn, skip Easy Apply jobs to focus on External ATS roles
          if (detected.type === 'easy_apply' && this.easyApplyLimitReached) {
            this.log(`🛑 Easy Apply daily cap active. Skipping "${job.title}" to focus on External ATS roles...`, 'info');
            tracker.record({ ...job, status: 'skipped', notes: 'Easy Apply limit reached' });
            continue;
          }

          const allowExternal = this.settings.search?.easyApplyOnly !== true &&
                                this.settings.search?.applyType !== 'easy_apply' &&
                                this.settings.externalApply?.enabled === true;
          let result = null;
          let isExternal = false;
          let externalPageRef = null;

          if (detected.type === 'easy_apply') {
            this.log('Triggering LinkedIn Easy Apply modal...', 'info');
            await detected.element.click({ force: true });
            await browserBridge.humanDelay(600, 1200);

            try {
              const screenshot = await browserBridge.takeScreenshot();
              if (screenshot) this.emit('screenshot', screenshot);
            } catch (_) {}

            const eaMode = this.settings.execution?.easyApplyMode || this.settings.execution?.mode || 'autonomous';
            result = await this.easyApplyModal.handleModal(job, {
              mode: eaMode,
              settings: this.settings,
              onStatusUpdate: msg => this.log(msg),
              isCancelled: () => this.isStopped || this.state === 'stopped'
            });
          } else if (detected.type === 'external_apply') {
            if (!allowExternal) {
              this.log(`External company listing found, but "Easy Apply Only" is active in settings. Skipping.`, 'info');
              tracker.record({ ...job, status: 'skipped', notes: 'External apply skipped (Easy Apply Only setting)' });
              continue;
            }

            isExternal = true;
            this.log(`🌐 Universal External Apply: Initiating application for "${job.title}" at "${job.company}"...`, 'info');
            const extMode = this.settings.execution?.externalMode || this.settings.execution?.mode || 'autonomous';
            result = await this.externalApplyEngine.handleExternalApply(page, job, {
              mode: extMode,
              settings: this.settings,
              onStatusUpdate: msg => this.log(msg),
              isCancelled: () => this.isStopped || this.state === 'stopped'
            });
            if (result && result.page) {
              externalPageRef = result.page;
            }
          }

          const cvNote = job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : '';

          if (result && result.status === 'needs_review') {
            const isStrictReview = (mode === 'review' || this.settings.execution?.mode === 'review') &&
                                   this.settings.execution?.pauseForReviewInHybridMode === true;

            if (!isStrictReview) {
              this.log(`🚀 Fully Autonomous Mode: Auto-submitting application for "${job.title}" without manual approval...`, 'info');
              let autoSubmitted = false;

              if (isExternal && externalPageRef && !externalPageRef.isClosed()) {
                try {
                  const extSubmit = await externalPageRef.$(
                    'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit application"), button:has-text("Submit"), button:has-text("Send Application"), button:has-text("Complete Application")'
                  );
                  if (extSubmit && await extSubmit.isVisible()) {
                    await extSubmit.click({ force: true }).catch(() => {});
                    await browserBridge.humanDelay(2500, 4000);
                    autoSubmitted = true;
                  }
                  await externalPageRef.close().catch(() => {});
                } catch (e) {
                  this.log(`External auto-submission attempt: ${e.message}`, 'info');
                  if (externalPageRef && !externalPageRef.isClosed()) await externalPageRef.close().catch(() => {});
                }
              } else {
                try {
                  const submitBtn = await page.$(
                    'dialog button:has-text("Submit application"), dialog button:has-text("Submit"), [data-testid="dialog"] button:has-text("Submit"), button[aria-label*="Submit application"], button:has-text("Submit application"), button:has-text("Submit")'
                  );
                  if (submitBtn) {
                    await submitBtn.click({ force: true }).catch(() => {});
                    await browserBridge.humanDelay(2500, 4000);
                    await this.easyApplyModal.closeSuccessModal(page, msg => this.log(msg));
                    autoSubmitted = true;
                  }
                } catch (e) {
                  this.log(`Modal auto-submission attempt: ${e.message}`, 'info');
                }
              }

              if (autoSubmitted) {
                const entry = tracker.record({ ...job, status: 'applied', notes: cvNote || 'Autonomously applied' });
                this.sessionAppliedJobs.push(entry);
                this.log(`✓ Successfully submitted application autonomously for ${job.title} at ${job.company}!`, 'success');
                batchAppliedCount++;
              } else {
                tracker.record({ ...job, status: 'skipped', notes: result.message || 'Requires manual external login' });
                this.log(`External portal requires manual account login. Skipped to continue autonomous loop: "${job.title}"`, 'warn');
              }

              this.emit('stats_update', tracker.getStats(dailyLimit));
              continue;
            }

            this.state = 'awaiting_review';
            this.emit('state_change', this.state);

            let reviewScreenshot = null;
            if (isExternal && externalPageRef && !externalPageRef.isClosed()) {
              try {
                const buf = await externalPageRef.screenshot({ timeout: 3000, animations: 'disabled' });
                reviewScreenshot = buf.toString('base64');
              } catch (e) {}
            }
            if (!reviewScreenshot) {
              reviewScreenshot = await browserBridge.takeScreenshot();
            }
            if (reviewScreenshot) this.emit('screenshot', reviewScreenshot);

            this.log(`⏸ Application prepared and paused for your review on the dashboard: "${job.title}" at "${job.company}".`, 'warn');

            const decision = await new Promise(resolve => {
              this.reviewPromiseResolve = resolve;
            });

            if (decision === 'submit') {
              if (isExternal && externalPageRef && !externalPageRef.isClosed()) {
                try {
                  const extSubmit = await externalPageRef.$(
                    'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit"), button:has-text("Send Application")'
                  );
                  if (extSubmit) {
                    await extSubmit.click({ force: true }).catch(() => {});
                  }
                } catch (e) {
                  this.log(`Note on external submission: ${e.message}`, 'info');
                }
                await browserBridge.humanDelay(2000, 3500);
                await externalPageRef.close().catch(() => {});
              } else {
                try {
                  const submitBtn = await page.$(
                    'dialog button:has-text("Submit application"), dialog button:has-text("Submit"), [data-testid="dialog"] button:has-text("Submit"), button[aria-label*="Submit application"], button:has-text("Submit application"), button:has-text("Submit")'
                  );
                  if (submitBtn) {
                    await submitBtn.click({ force: true }).catch(() => {});
                    await browserBridge.humanDelay(2500, 4000);
                    await this.easyApplyModal.closeSuccessModal(page, msg => this.log(msg));
                  }
                } catch (e) {
                  this.log(`Note on modal submission: ${e.message}`, 'info');
                }
              }
              const entry = tracker.record({ ...job, status: 'applied', notes: cvNote || 'Approved and submitted by user' });
              this.sessionAppliedJobs.push(entry);
              this.log(`✓ Successfully submitted application for ${job.title} at ${job.company}!`, 'success');
              batchAppliedCount++;
            } else {
              if (isExternal && externalPageRef && !externalPageRef.isClosed()) {
                await externalPageRef.close().catch(() => {});
              } else {
                await this.easyApplyModal.dismissModal(page);
              }
              tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
              this.log(`Application skipped for ${job.title}.`, 'warn');
            }

            this.state = 'running';
            this.emit('state_change', this.state);
          } else if (result && result.status === 'limit_reached') {
            this.log('🛑 LinkedIn Easy Apply daily limit reached for today! Switching focus to External ATS & Remote boards.', 'warn');
            this.easyApplyLimitReached = true;
          } else if (result && result.status === 'already_applied') {
            if (isExternal && externalPageRef) {
              await externalPageRef.close().catch(() => {});
            } else {
              await this.easyApplyModal.dismissModal(page);
            }
            tracker.record({ ...job, status: 'previously_applied', notes: result.message || 'Already applied on LinkedIn' });
            this.log(`✓ Job "${job.title}" at "${job.company}" was already applied on LinkedIn. History updated.`, 'info');
          } else if (result && result.status === 'applied') {
            if (isExternal && externalPageRef) {
              await externalPageRef.close().catch(() => {});
            }
            const entry = tracker.record({ ...job, status: 'applied', notes: cvNote || result.message });
            this.sessionAppliedJobs.push(entry);
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

          const delay = Math.floor(Math.random() * 1000) + 1200;
          this.log(`Taking a natural ${Math.round(delay / 1000)}s rest before next listing...`, 'info');
          await this.interruptibleDelay(delay);
          if (this.isStopped) break;
        } catch (jobErr) {
          this.log(`⚠️ Note on "${job.title}": ${jobErr.message}. Moving to next job safely...`, 'warn');
          tracker.record({ ...job, status: 'failed', notes: jobErr.message });
          try {
            await this.easyApplyModal.dismissModal(page);
          } catch (_) {}
          try {
            page = await browserBridge.getPage();
          } catch (_) {}
        }
      }
    }
    return batchAppliedCount;
  }

  getStatus() {
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    return {
      state: this.state,
      currentJob: this.currentJob,
      activePlatform: this.settings.activePlatform || 'all',
      stats: tracker.getStats(dailyLimit),
      sessionAppliedCount: this.sessionAppliedJobs.length,
      logs: this.logs.slice(0, 100)
    };
  }
}

module.exports = new Orchestrator();
