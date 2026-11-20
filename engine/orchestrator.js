const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const browserBridge = require('./browserBridge');
const tracker = require('./tracker');
const vaultManager = require('./vaultManager');
const SearchEngine = require('./searchEngine');
const EasyApplyModal = require('./easyApplyModal');
const ExternalApplyEngine = require('./externalApplyEngine');
const eligibilityEngine = require('./eligibilityEngine');
const ghostJobFilter = require('./ghostJobFilter');
const GmailMonitor = require('./gmailMonitor');
const RemoteBoardsEngine = require('./platforms/remoteBoardsEngine');
const WellfoundEngine = require('./platforms/wellfoundEngine');
const CompanyAtsEngine = require('./platforms/companyAtsEngine');
const YCombinatorEngine = require('./platforms/ycombinatorEngine');
const OttaEngine = require('./platforms/ottaEngine');
const VcPortfolioEngine = require('./platforms/vcPortfolioEngine');
const outreachGenerator = require('./outreachGenerator');
const triAiEvaluator = require('./triAiEvaluator');

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'awaiting_review'
    this.isStopped = false;
    this.skippedAuthPlatforms = new Set();
    this.activeLoopPromise = null;
    this.searchEngine = new SearchEngine(browserBridge);
    this.easyApplyModal = new EasyApplyModal(browserBridge);
    this.externalApplyEngine = new ExternalApplyEngine(browserBridge);
    this.remoteBoardsEngine = new RemoteBoardsEngine(browserBridge, this.externalApplyEngine);
    this.wellfoundEngine = new WellfoundEngine(browserBridge);
    this.companyAtsEngine = new CompanyAtsEngine(browserBridge, this.externalApplyEngine);
    this.ycombinatorEngine = new YCombinatorEngine(browserBridge);
    this.ottaEngine = new OttaEngine(browserBridge, this.externalApplyEngine);
    this.vcPortfolioEngine = new VcPortfolioEngine(browserBridge, this.externalApplyEngine);
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

  
  startLiveScreenStream() {
    if (this._screencastInterval) return;
    this._screencastInterval = setInterval(async () => {
      if (this.state !== 'running' && this.state !== 'awaiting_review') return;
      try {
        if (browserBridge.page && !browserBridge.page.isClosed()) {
          const ss = await browserBridge.takeScreenshot();
          if (ss) {
            this.emit('screenshot', ss);
          }
        }
      } catch (_) {}
    }, 1200);
  }

  stopLiveScreenStream() {
    if (this._screencastInterval) {
      clearInterval(this._screencastInterval);
      this._screencastInterval = null;
    }
  }

  async start() {
    this.startLiveScreenStream();
    if (this.state === 'running' || this.activeLoopPromise) {
      this.log('Automation is currently active or stopping. Please wait a second before starting.', 'warn');
      return;
    }

    const cloudAiGateway = require('./cloudAiGateway');
    const credits = cloudAiGateway.getCachedCredits();
    if (typeof credits === 'number' && credits <= 0) {
      this.log('🛑 [Credit System] Start blocked: You have 0 credits remaining. Please top up your balance in Credits modal.', 'error');
      this.state = 'idle';
      this.emit('state_change', this.state);
      return;
    }
    if (this.state === 'paused') {
      this.state = 'running';
    if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.clear();
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
    this.stopLiveScreenStream();
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
    const cloudAiGateway = require('./cloudAiGateway');
    if (cloudAiGateway.getCachedCredits() <= 0) {
      this.log('🛑 [Credit System] 0 credits remaining. Automation stopped safely. Please top up your balance.', 'warn');
      return true;
    }
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
      try {
        const initialSs = await browserBridge.takeScreenshot();
        if (initialSs) this.emit('screenshot', initialSs);
      } catch (_) {}

      const activePlatform = (this.settings.activePlatform || 'all').toLowerCase();
      const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
      this.log(`🎯 Active Execution Target: ${activePlatform.toUpperCase()} (Daily Limit: ${dailyLimit})`, 'info');

      let round = 1;

      // CONTINUOUS LOOP: Keeps searching and applying until daily target is met or user clicks Stop
      while (!this.isStopped && !this.isLimitReached(totalSessionApplied)) {
        this.log(`🚀 [Round ${round}] Starting comprehensive application sweep across platforms...`, 'info');
        let roundAppliedCount = 0;

        // 0. Direct Company ATS Scan & Autonomous Apply (Ashby, Greenhouse, Lever)
        if (!this.isStopped && (this.settings.directCompanyAts?.enabled !== false) && (activePlatform === 'all' || activePlatform === 'direct_ats' || activePlatform === 'direct_company_ats')) {
          try {
            // First check if we already have queued / pending jobs ready to apply immediately
            if (this.settings.directCompanyAts?.autoApply !== false && !this.isLimitReached(totalSessionApplied)) {
              const pendingCount = await this.runDirectCompanyAtsLoop(page, totalSessionApplied);
              roundAppliedCount += pendingCount;
              totalSessionApplied += pendingCount;
            }

            // If still under limit, refresh ATS scan from company endpoints
            if (!this.isLimitReached(totalSessionApplied)) {
              this.log('🔍 [Direct Company ATS] Sourcing verified company career listings via ATS endpoints...', 'info');
              await this.companyAtsEngine.scanAllCompanies(this.settings, msg => this.log(msg, 'info'));

              if (this.settings.directCompanyAts?.autoApply !== false && !this.isLimitReached(totalSessionApplied)) {
                const count = await this.runDirectCompanyAtsLoop(page, totalSessionApplied);
                roundAppliedCount += count;
                totalSessionApplied += count;
              }
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

        // 2.5 Y Combinator Startup Loop (Work at a Startup)
        if (!this.isStopped && (activePlatform === 'all' || activePlatform === 'ycombinator')) {
          if (!this.isLimitReached(totalSessionApplied)) {
            try {
              const count = await this.runYCombinatorLoop(page, totalSessionApplied);
              roundAppliedCount += count;
              totalSessionApplied += count;
            } catch (ycErr) {
              this.log(`⚠️ Y Combinator sweep error: ${ycErr.message}. Continuing...`, 'warn');
            }
          }
        }

        // 2.6 Otta Tech Scaleup Loop (Welcome to the Jungle)
        if (!this.isStopped && (activePlatform === 'all' || activePlatform === 'otta')) {
          if (!this.isLimitReached(totalSessionApplied)) {
            try {
              const count = await this.runOttaLoop(page, totalSessionApplied);
              roundAppliedCount += count;
              totalSessionApplied += count;
            } catch (ottaErr) {
              this.log(`⚠️ Otta sweep error: ${ottaErr.message}. Continuing...`, 'warn');
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
    const isAutoApply = this.settings.directCompanyAts?.autoApply !== false;
    const minScore = this.settings.directCompanyAts?.minimumMatchScore || 70;

    const queuedJobs = (atsData.jobs || []).filter(j => {
      if (j.status === 'auto_queued_for_apply' || j.status === 'approved_queued_for_apply') return true;
      if (isAutoApply && (j.status === 'PENDING_APPROVAL' || j.status === 'alerted_pending_approval')) {
        if (typeof j.score === 'number' && j.score < minScore) return false;
        return true;
      }
      return false;
    });

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

        // Pre-filter: Check citizenship and clearance
        const eligibility = eligibilityEngine.evaluateEligibility(job, this.settings);
        if (!eligibility.eligible) {
          this.log(`🛡️ Pre-filter: Skipped "${job.title}" (${eligibility.reason})`, 'warn');
          job.status = 'skipped_eligibility';
          job.failureReason = eligibility.reason;
          this.companyAtsEngine.saveAtsJobs(atsData);
          continue;
        }

        // Tri-AI Consensus Gate: Check 3-model evaluation if cached
        const evalData = triAiEvaluator.getCachedEvaluation(job.jobId);
        if (evalData) {
          if (evalData.recommendationTier === 'reject' || (typeof evalData.consensusScore === 'number' && evalData.consensusScore < 5.0)) {
            this.log(`🛑 Tri-AI Gated: Skipped "${job.title}" at "${job.company}" (${evalData.consensusScore}/10 - ${evalData.consensusVerdict})`, 'warn');
            job.status = 'rejected_by_ai';
            job.failureReason = `Tri-AI: ${evalData.consensusScore}/10 (${evalData.consensusVerdict})`;
            this.companyAtsEngine.saveAtsJobs(atsData);
            continue;
          }
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

          // Step 2 Cold Outreach hook
          try {
            const outreach = outreachGenerator.generateOutreach(job.company, job.title);
            this.log(`✉️ [Step 2 Follow-Up] 1-Click Decision Maker search: ${outreach.links.findOnLinkedIn}`, 'info');
          } catch (_) {}
        } else if (result && (result.status === 'canceled' || result.clientMessage)) {
          const clientMsg = result.clientMessage || `Sir, this is the problem we are facing: ${result.message || 'ATS obstacle encountered'}. So we are canceling the job apply, you please see another one.`;
          tracker.record({ ...job, status: 'canceled', notes: clientMsg });
          this.log(clientMsg, 'warn');
          this.emit('client_message', { message: clientMsg, job });
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
        // History checkpoint & Pre-flight audit
        const preFlight = tracker.evaluatePreFlightClass(job);
        if (preFlight.action === 'SKIP') {
          if (preFlight.class === 'DONE') {
            alreadyAppliedCount++;
            continue;
          }
          if (preFlight.class === 'HOLD') {
            this.log(`⏸️ Pre-flight: Skipped "${job.title}" at "${job.company}" (Job on HOLD: ${preFlight.reason}).`, 'info');
            continue;
          }
          if (preFlight.class === 'COOLDOWN') {
            this.log(`⏳ Pre-flight: Skipped "${job.title}" at "${job.company}" (In COOLDOWN: ${preFlight.reason}, ${preFlight.daysLeft || 7}d remaining).`, 'info');
            continue;
          }
        }

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

        const result = await Promise.race([
          this.remoteBoardsEngine.applyJob(page, job, {
            mode: this.settings.execution?.externalMode || this.settings.execution?.mode || 'autonomous',
            settings: this.settings,
            onStatusUpdate: msg => this.log(msg),
            orchestrator: this
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Remote ATS operation timed out (65s limit)')), 65000))
        ]).catch(err => ({ status: 'failed', message: err.message }));

        if (result && result.status === 'needs_review') {
          this.state = 'awaiting_review';
          this.emit('state_change', this.state);
          const screenshot = await browserBridge.takeScreenshot();
          if (screenshot) this.emit('screenshot', screenshot);

          const decision = await new Promise(resolve => { this.reviewPromiseResolve = resolve; });
          if (decision === 'submit') {
            this.log(`🕵️ Running 2-step verification on reviewed application for "${job.title}"...`, 'info');
            const verification = await this.externalApplyEngine.verifyExternalSubmission(page, msg => this.log(msg));
            if (verification.confirmed) {
              const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved & verified by user' });
              this.sessionAppliedJobs.push(entry);
              count++;
              this.log(`✓ Submitted & verified application for "${job.title}" at "${job.company}"!`, 'success');
            } else {
              this.log(`⚠️ User approved, but ATS verification unconfirmed: ${verification.reason}. Recording as unverified.`, 'warn');
              tracker.record({ ...job, status: 'unverified', notes: `Review approved but unverified: ${verification.reason}` });
            }
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
        } else if (result && result.status === 'previously_applied') {
          tracker.record({ ...job, status: 'previously_applied', notes: result.message || 'Already applied' });
          this.log(`🛡️ Already applied to "${job.title}" at "${job.company}".`, 'info');
        } else if (result && (result.status === 'canceled' || result.clientMessage)) {
          const clientMsg = result.clientMessage || `Sir, this is the problem we are facing: ${result.message || 'ATS obstacle encountered'}. So we are canceling the job apply, you please see another one.`;
          tracker.record({ ...job, status: 'canceled', notes: clientMsg });
          this.log(clientMsg, 'warn');
          this.emit('client_message', { message: clientMsg, job });
        } else if (result && result.status === 'skipped') {
          tracker.record({ ...job, status: 'skipped', notes: result.reason || result.message || 'Skipped' });
          this.log(`⏩ Pre-flight/Policy skipped "${job.title}" at "${job.company}" (${result.reason || result.code || 'Skipped'}).`, 'info');
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
    if (this.skippedAuthPlatforms && this.skippedAuthPlatforms.has('wellfound')) {
      return 0;
    }
    let isLogged = await this.wellfoundEngine.isLoggedIn(page);
    if (!isLogged) {
      const isAutonomous = this.settings.execution?.mode === 'autonomous';
      if (isAutonomous) {
        this.log('ℹ️ [Wellfound] No active session found. Skipping in autonomous mode without blocking.', 'info');
        if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('wellfound');
        return 0;
      } else {
        this.log('⚠️ Wellfound login required. Waiting up to 10s...', 'warn');
        let waited = 0;
        while (waited < 10) {
          await new Promise(r => setTimeout(r, 2000));
          waited += 2;
          if (this.state === 'stopped' || this.isStopped) return 0;
          isLogged = await this.wellfoundEngine.isLoggedIn(page);
          if (isLogged) break;
        }
        if (!isLogged) {
          this.log('ℹ️ Skipping Wellfound for this cycle.', 'info');
          if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('wellfound');
          return 0;
        }
      }
    }
    this.log('✓ Successfully verified Wellfound active session!', 'success');

    const seenSlugs = new Set();
    for (const keyword of keywords) {
      if (this.isLimitReached(currentBatch + appliedCount)) break;

      const roleSlug = this.wellfoundEngine.getRoleSlug(keyword);
      if (seenSlugs.has(roleSlug)) {
        continue;
      }
      seenSlugs.add(roleSlug);

      this.log(`🔍 [Wellfound] Searching startup roles for: "${keyword}" (/role/r/${roleSlug})...`, 'info');
      let jobs = [];
      try {
        jobs = await this.wellfoundEngine.searchJobs(page, keyword, this.settings, msg => this.log(msg));
      } catch (e) {
        this.log(`Wellfound search error for "${keyword}": ${e.message}`, 'warn');
        continue;
      }

      let unappliedCount = 0;
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
          unappliedCount++;

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
              this.log(`🕵️ Running 2-step verification on reviewed Wellfound application for "${job.title}"...`, 'info');
              const verification = await this.wellfoundEngine.verifyWellfoundSubmission(page, msg => this.log(msg));
              if (verification.confirmed) {
                const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved & verified by user' });
                this.sessionAppliedJobs.push(entry);
                appliedCount++;
                this.log(`✓ Submitted & verified Wellfound application for ${job.title}!`, 'success');
              } else {
                this.log(`⚠️ User approved, but Wellfound verification unconfirmed: ${verification.reason}.`, 'warn');
                tracker.record({ ...job, status: 'unverified', notes: `Review approved but unverified: ${verification.reason}` });
              }
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
          } else if (result && (result.status === 'canceled' || result.clientMessage)) {
          const clientMsg = result.clientMessage || `Sir, this is the problem we are facing: ${result.message || 'ATS obstacle encountered'}. So we are canceling the job apply, you please see another one.`;
          tracker.record({ ...job, status: 'canceled', notes: clientMsg });
          this.log(clientMsg, 'warn');
          this.emit('client_message', { message: clientMsg, job });
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
      if (jobs.length > 0 && unappliedCount === 0) {
        this.log(`ℹ️ [Wellfound] All ${jobs.length} listings for "${roleSlug}" were already applied to previously in your tracker.`, 'info');
      }
    }
    return appliedCount;
  }


  /**
   * Y Combinator Startup Loop (Work at a Startup)
   */
  async runYCombinatorLoop(page, currentBatch) {
    let appliedCount = 0;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);
    const keywords = this.settings.search?.keywords || ['AI Engineer'];

    this.log('🚀 [Y Combinator] Connecting to YC Work at a Startup...', 'info');
    if (this.skippedAuthPlatforms && this.skippedAuthPlatforms.has('ycombinator')) {
      return 0;
    }
    let isLogged = await this.ycombinatorEngine.isLoggedIn(page);
    if (!isLogged) {
      const isAutonomous = this.settings.execution?.mode === 'autonomous';
      if (isAutonomous) {
        this.log('ℹ️ [Y Combinator] No active session found. Skipping in autonomous mode without blocking.', 'info');
        if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('ycombinator');
        return 0;
      } else {
        this.log('⚠️ Y Combinator login required. Waiting up to 10s...', 'warn');
        let waited = 0;
        while (waited < 10) {
          await new Promise(r => setTimeout(r, 2000));
          waited += 2;
          if (this.state === 'stopped' || this.isStopped) return 0;
          isLogged = await this.ycombinatorEngine.isLoggedIn(page);
          if (isLogged) break;
        }
        if (!isLogged) {
          this.log('ℹ️ Skipping YC for this cycle.', 'info');
          if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('ycombinator');
          return 0;
        }
      }
    }
    this.log('✓ Successfully verified Y Combinator active session!', 'success');

    const seenUrls = new Set();
    for (const keyword of keywords) {
      if (this.isLimitReached(currentBatch + appliedCount)) break;

      this.log(`🔍 [Y Combinator] Searching roles for: "${keyword}"...`, 'info');
      let jobs = [];
      try {
        jobs = await this.ycombinatorEngine.searchJobs(page, keyword, this.settings, msg => this.log(msg));
      } catch (e) {
        this.log(`YC search error for "${keyword}": ${e.message}`, 'warn');
        continue;
      }

      let unappliedCount = 0;
      for (const job of jobs) {
        if (maxPerCat > 0 && appliedCount >= maxPerCat) {
          this.log(`🎯 Reached category quota (${appliedCount}/${maxPerCat}) for Y Combinator.`, 'info');
          break;
        }
        if (this.isLimitReached(currentBatch + appliedCount)) break;

        while (this.state === 'paused') {
          await new Promise(r => setTimeout(r, 1000));
          if (this.state === 'stopped' || this.isStopped) break;
        }
        if (this.state === 'stopped' || this.isStopped) break;

        if (seenUrls.has(job.url)) continue;
        seenUrls.add(job.url);

        try {
          const priorApp = tracker.findPriorApplication(job);
          if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
            continue;
          }
          unappliedCount++;

          this.currentJob = job;
          this.emit('current_job', job);
          this.log(`👉 [Y Combinator] Reviewing: "${job.title}" at "${job.company}"`, 'info');

          try {
            if (!page || page.isClosed()) {
              page = await browserBridge.getPage();
            }
          } catch (pErr) {
            page = await browserBridge.getPage();
          }

          const result = await this.ycombinatorEngine.applyJob(page, job, {
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
              this.log(`🕵️ Running 2-step verification on reviewed YC application for "${job.title}"...`, 'info');
              const verification = await this.ycombinatorEngine.verifyYCombinatorSubmission(page, msg => this.log(msg));
              if (verification.confirmed) {
                const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved & verified by user' });
                this.sessionAppliedJobs.push(entry);
                appliedCount++;
                this.log(`✓ Submitted & verified YC application for ${job.title}!`, 'success');
              } else {
                this.log(`⚠️ User approved, but YC verification unconfirmed: ${verification.reason}.`, 'warn');
                tracker.record({ ...job, status: 'unverified', notes: `Review approved but unverified: ${verification.reason}` });
              }
            } else {
              tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
            }
            this.state = 'running';
            this.emit('state_change', this.state);
          } else if (result && result.status === 'applied') {
            const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : result.message });
            this.sessionAppliedJobs.push(entry);
            appliedCount++;
            this.log(`✓ Successfully applied to "${job.title}" at "${job.company}" on Y Combinator!`, 'success');
          } else if (result && result.status === 'previously_applied') {
            tracker.record({ ...job, status: 'previously_applied', notes: result.message });
          } else {
            tracker.record({ ...job, status: 'failed', notes: result?.message || 'Failed' });
          }

          this.emit('stats_update', tracker.getStats(dailyLimit));
          this.currentJob = null;
          this.emit('current_job', null);

          const delay = Math.floor(Math.random() * 2500) + 2500;
          await this.interruptibleDelay(delay);
        } catch (jobErr) {
          this.log(`⚠️ Note on YC "${job.title}": ${jobErr.message}. Continuing...`, 'warn');
          tracker.record({ ...job, status: 'failed', notes: jobErr.message });
        }
      }

      if (jobs.length > 0 && unappliedCount === 0) {
        this.log(`ℹ️ [Y Combinator] All ${jobs.length} listings for "${keyword}" were already applied to previously.`, 'info');
      }
    }

    return appliedCount;
  }

  /**
   * Otta Tech Scaleup Loop (Welcome to the Jungle)
   */
  async runOttaLoop(page, currentBatch) {
    let appliedCount = 0;
    const dailyLimit = this.settings.execution?.dailyApplicationLimit || 100;
    const maxPerCat = parseInt(process.env.MAX_PER_CATEGORY || this.settings.execution?.maxPerCategory || '0', 10);
    const keywords = this.settings.search?.keywords || ['AI Engineer'];

    this.log('🚀 [Otta] Connecting to Otta tech stream...', 'info');
    if (this.skippedAuthPlatforms && this.skippedAuthPlatforms.has('otta')) {
      return 0;
    }
    let isLogged = await this.ottaEngine.isLoggedIn(page);
    if (!isLogged) {
      // Check if credentials are stored in Vault
      const vaultCreds = vaultManager.getPlatformCredentials('otta');
      if (vaultCreds && vaultCreds.email && vaultCreds.password) {
        this.log('🔐 [Otta] Attempting autonomous login via Vault credentials...', 'info');
        const logged = await this.ottaEngine.loginWithCredentials(page, vaultCreds);
        if (logged) {
          isLogged = true;
          this.log('✅ [Otta] Autonomous login via Vault successful!', 'success');
        }
      }
    }
    if (!isLogged) {
      const isAutonomous = this.settings.execution?.mode === 'autonomous';
      if (isAutonomous) {
        this.log('ℹ️ [Otta] No active session found. Skipping in autonomous mode without blocking.', 'info');
        if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('otta');
        return 0;
      } else {
        this.log('⚠️ Otta login required. Waiting up to 10s...', 'warn');
        let waited = 0;
        while (waited < 10) {
          await new Promise(r => setTimeout(r, 2000));
          waited += 2;
          if (this.state === 'stopped' || this.isStopped) return 0;
          isLogged = await this.ottaEngine.isLoggedIn(page);
          if (isLogged) break;
        }
        if (!isLogged) {
          this.log('ℹ️ Skipping Otta for this cycle.', 'info');
          if (this.skippedAuthPlatforms) this.skippedAuthPlatforms.add('otta');
          return 0;
        }
      }
    }
    this.log('✓ Successfully verified Otta active session!', 'success');

    const seenUrls = new Set();
    for (const keyword of keywords) {
      if (this.isLimitReached(currentBatch + appliedCount)) break;

      this.log(`🔍 [Otta] Searching scaleup roles for: "${keyword}"...`, 'info');
      let jobs = [];
      try {
        jobs = await this.ottaEngine.searchJobs(page, keyword, this.settings, msg => this.log(msg));
      } catch (e) {
        this.log(`Otta search error for "${keyword}": ${e.message}`, 'warn');
        continue;
      }

      let unappliedCount = 0;
      for (const job of jobs) {
        if (maxPerCat > 0 && appliedCount >= maxPerCat) {
          this.log(`🎯 Reached category quota (${appliedCount}/${maxPerCat}) for Otta.`, 'info');
          break;
        }
        if (this.isLimitReached(currentBatch + appliedCount)) break;

        while (this.state === 'paused') {
          await new Promise(r => setTimeout(r, 1000));
          if (this.state === 'stopped' || this.isStopped) break;
        }
        if (this.state === 'stopped' || this.isStopped) break;

        if (seenUrls.has(job.url)) continue;
        seenUrls.add(job.url);

        try {
          const priorApp = tracker.findPriorApplication(job);
          if (priorApp && (priorApp.status === 'applied' || priorApp.status === 'previously_applied')) {
            continue;
          }
          unappliedCount++;

          this.currentJob = job;
          this.emit('current_job', job);
          this.log(`👉 [Otta] Inspecting: "${job.title}" at "${job.company}"`, 'info');

          try {
            if (!page || page.isClosed()) {
              page = await browserBridge.getPage();
            }
          } catch (pErr) {
            page = await browserBridge.getPage();
          }

          const result = await this.ottaEngine.applyJob(page, job, {
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
              this.log(`🕵️ Running 2-step verification on reviewed Otta application for "${job.title}"...`, 'info');
              const verification = await this.externalApplyEngine.verifyExternalSubmission(page, msg => this.log(msg));
              if (verification.confirmed) {
                const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : 'Approved & verified by user' });
                this.sessionAppliedJobs.push(entry);
                appliedCount++;
                this.log(`✓ Submitted & verified Otta application for ${job.title}!`, 'success');
              } else {
                this.log(`⚠️ User approved, but Otta verification unconfirmed: ${verification.reason}.`, 'warn');
                tracker.record({ ...job, status: 'unverified', notes: `Review approved but unverified: ${verification.reason}` });
              }
            } else {
              tracker.record({ ...job, status: 'skipped', notes: 'Skipped by user review' });
            }
            this.state = 'running';
            this.emit('state_change', this.state);
          } else if (result && result.status === 'applied') {
            const entry = tracker.record({ ...job, status: 'applied', notes: job.tailoredCV ? `Tailored ATS CV: ${job.tailoredCV}` : result.message });
            this.sessionAppliedJobs.push(entry);
            appliedCount++;
            this.log(`✓ Successfully applied to "${job.title}" at "${job.company}" on Otta!`, 'success');
          } else if (result && result.status === 'previously_applied') {
            tracker.record({ ...job, status: 'previously_applied', notes: result.message });
          } else {
            tracker.record({ ...job, status: 'failed', notes: result?.message || 'Failed' });
          }

          this.emit('stats_update', tracker.getStats(dailyLimit));
          this.currentJob = null;
          this.emit('current_job', null);

          const delay = Math.floor(Math.random() * 2500) + 2500;
          await this.interruptibleDelay(delay);
        } catch (jobErr) {
          this.log(`⚠️ Note on Otta "${job.title}": ${jobErr.message}. Continuing...`, 'warn');
          tracker.record({ ...job, status: 'failed', notes: jobErr.message });
        }
      }

      if (jobs.length > 0 && unappliedCount === 0) {
        this.log(`ℹ️ [Otta] All ${jobs.length} listings for "${keyword}" were already applied to previously.`, 'info');
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
        } else {
          // Navigate to LinkedIn feed to check session
          await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        }
      }
    } catch (_) {}
    let loggedIn = await browserBridge.isLinkedInLoggedIn();
    if (!loggedIn) {
      try {
        if (!page.url().includes('linkedin.com')) {
          await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          loggedIn = await browserBridge.isLinkedInLoggedIn();
        }
      } catch (_) {}
    }
    if (!loggedIn) {
      // 1. Check if user configured credentials in vault for autonomous silent login
      const autoLoginEngine = require('./autoLoginEngine');
      const creds = vaultManager.getPlatformCredentials('linkedin');
      if (creds && creds.email && creds.password) {
        this.log(`🤖 [Auto-Login] No active session detected. Executing autonomous silent login for ${creds.email}...`, 'info');
        const loginRes = await autoLoginEngine.login('linkedin', creds);
        if (loginRes.status === 'success') {
          loggedIn = true;
          this.log('✓ [Auto-Login] Successfully authenticated LinkedIn session!', 'success');
        } else if (loginRes.status === 'challenge_required') {
          this.log(`🔐 [2FA Challenge] ${loginRes.message}. Please enter the code in the Dashboard modal.`, 'warn');
          this.emit('auth_challenge_required', { platform: 'linkedin', message: loginRes.message });

          // Wait for user to input 2FA code in dashboard modal
          let waited = 0;
          const maxWait = 180;
          while (waited < maxWait && autoLoginEngine.activeChallenges.has('linkedin') && !(await browserBridge.isLinkedInLoggedIn())) {
            await new Promise(r => setTimeout(r, 3000));
            waited += 3;
            if (waited % 15 === 0) {
              this.log(`⏳ Waiting for verification code entry in Dashboard... (${waited}s / ${maxWait}s)`, 'info');
            }
          }
          loggedIn = await browserBridge.isLinkedInLoggedIn();
        } else if (loginRes.status === 'bad_credentials') {
          this.log(`❌ [Auto-Login] Incorrect email or password. Please update credentials in Dashboard.`, 'error');
          throw new Error('LinkedIn login failed: Invalid credentials. Please update credentials in the Dashboard.');
        }
      } else {
        this.log('⚠️ LinkedIn credentials not found in vault. Please enter your email and password in the Auto-Login panel.', 'warn');
        this.emit('auth_challenge_required', { platform: 'linkedin', challengeType: 'credentials_needed', message: 'Please enter your LinkedIn credentials in the Auto-Login panel.' });
        
        let waited = 0;
        while (waited < 120 && !(await browserBridge.isLinkedInLoggedIn())) {
          await new Promise(r => setTimeout(r, 3000));
          waited += 3;
        }
        loggedIn = await browserBridge.isLinkedInLoggedIn();
      }

      if (!loggedIn) {
        throw new Error('LinkedIn authentication incomplete. Please enter credentials or verification code in the dashboard.');
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

      this.currentSearchUrl = this.searchEngine.buildSearchUrl(keyword, this.settings, 0);
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
            // If main page was left on redirect tracker or blank, bring it back to search
            const curUrl = page.url();
            if (curUrl.includes('jobs-tracker') || curUrl === 'about:blank') {
              this.log(`🔄 Main page drifted (${curUrl.slice(0, 45)}). Restoring search page...`, 'info');
              const restoreUrl = this.currentSearchUrl || this.searchEngine.lastSearchUrl || 'https://www.linkedin.com/jobs/';
              await page.goto(restoreUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
              await browserBridge.humanDelay(2000, 3000);
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
            result = await Promise.race([
              this.easyApplyModal.handleModal(job, {
                mode: eaMode,
                settings: this.settings,
                onStatusUpdate: msg => this.log(msg),
                isCancelled: () => this.isStopped || this.state === 'stopped',
                orchestrator: this
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Easy Apply operation timed out (75s limit)')), 75000))
            ]).catch(err => ({ status: 'failed', message: err.message }));
          } else if (detected.type === 'external_apply') {
            if (!allowExternal) {
              this.log(`External company listing found, but "Easy Apply Only" is active in settings. Skipping.`, 'info');
              tracker.record({ ...job, status: 'skipped', notes: 'External apply skipped (Easy Apply Only setting)' });
              continue;
            }

            isExternal = true;
            this.log(`🌐 Universal External Apply: Initiating application for "${job.title}" at "${job.company}"...`, 'info');
            const extMode = this.settings.execution?.externalMode || this.settings.execution?.mode || 'autonomous';
            result = await Promise.race([
              this.externalApplyEngine.handleExternalApply(page, job, {
                mode: extMode,
                settings: this.settings,
                onStatusUpdate: msg => this.log(msg),
                isCancelled: () => this.isStopped || this.state === 'stopped',
                orchestrator: this
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('External portal operation timed out (65s limit)')), 65000))
            ]).catch(err => ({ status: 'failed', message: err.message }));
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
                  const activeDialog = await this.easyApplyModal.getActiveDialog(page);
                  const submitBtn = activeDialog ? await this.easyApplyModal.findButtonInDialog(activeDialog, 'submit') : await page.$(
                    'button[aria-label*="Submit application"], button:has-text("Submit application"), button:has-text("Submit")'
                  );
                  if (submitBtn) {
                    await submitBtn.click({ force: true }).catch(() => {});
                    await browserBridge.humanDelay(2000, 3500);
                    const verification = await this.easyApplyModal.verifyApplicationSubmitted(page, activeDialog, msg => this.log(msg));
                    if (verification.verified) {
                      autoSubmitted = true;
                    } else {
                      this.log(`⚠️ Auto-submission verification failed: ${verification.reason || 'Not confirmed'}`, 'warn');
                    }
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
                await this.easyApplyModal.dismissModal(page);
                tracker.record({ ...job, status: 'failed', notes: result.message || 'Submission verification failed or missing required fields' });
                this.log(`Application could not be confirmed as submitted for "${job.title}". Recorded as failed to prevent false positive.`, 'warn');
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
                const verification = await this.externalApplyEngine.verifyExternalSubmission(externalPageRef, msg => this.log(msg));
                await externalPageRef.close().catch(() => {});
                if (verification.confirmed) {
                  const entry = tracker.record({ ...job, status: 'applied', notes: cvNote || 'Approved and submitted by user' });
                  this.sessionAppliedJobs.push(entry);
                  this.log(`✓ Successfully submitted & verified application for ${job.title} at ${job.company}!`, 'success');
                  batchAppliedCount++;
                } else {
                  tracker.record({ ...job, status: 'unverified', notes: `Review approved but unverified: ${verification.reason}` });
                  this.log(`⚠️ External application unconfirmed: ${verification.reason}`, 'warn');
                }
              } else {
                try {
                  const activeDialog = await this.easyApplyModal.getActiveDialog(page);
                  const submitBtn = activeDialog ? await this.easyApplyModal.findButtonInDialog(activeDialog, 'submit') : await page.$(
                    'button[aria-label*="Submit application"], button:has-text("Submit application"), button:has-text("Submit")'
                  );
                  if (submitBtn) {
                    await submitBtn.click({ force: true }).catch(() => {});
                    await browserBridge.humanDelay(2000, 3500);
                    const verification = await this.easyApplyModal.verifyApplicationSubmitted(page, activeDialog, msg => this.log(msg));
                    if (verification.verified) {
                      const entry = tracker.record({ ...job, status: 'applied', notes: cvNote || 'Approved and submitted by user' });
                      this.sessionAppliedJobs.push(entry);
                      this.log(`✓ Successfully submitted application for ${job.title} at ${job.company}!`, 'success');
                      batchAppliedCount++;
                    } else {
                      await this.easyApplyModal.dismissModal(page);
                      tracker.record({ ...job, status: 'failed', notes: verification.reason || 'Verification failed after review submit' });
                      this.log(`⚠️ Application could not be confirmed as submitted for ${job.title}: ${verification.reason || 'Not verified'}`, 'warn');
                    }
                  } else {
                    await this.easyApplyModal.dismissModal(page);
                    tracker.record({ ...job, status: 'failed', notes: 'Submit button not found' });
                    this.log(`⚠️ Submit button was not found in dialog for ${job.title}`, 'warn');
                  }
                } catch (e) {
                  this.log(`Note on modal submission: ${e.message}`, 'info');
                }
              }
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
          } else if (result && (result.status === 'canceled' || result.clientMessage)) {
            if (isExternal && externalPageRef) {
              await externalPageRef.close().catch(() => {});
            } else {
              await this.easyApplyModal.dismissModal(page);
            }
            const clientMsg = result.clientMessage || `Sir, this is the problem we are facing: ${result.message || 'AI could not resolve form obstacle'}. So we are canceling the job apply, you please see another one.`;
            tracker.record({ ...job, status: 'canceled', notes: clientMsg });
            this.log(clientMsg, 'warn');
            this.emit('client_message', { message: clientMsg, job });
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
