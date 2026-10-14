const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'config', 'settings.json');

class AutopilotScheduler extends EventEmitter {
  constructor(orchestrator) {
    super();
    this.orchestrator = orchestrator;
    this.timer = null;
    this.intervalMinutes = 120; // 2 hours default
    this.batchSize = 10;        // 10 jobs per cycle
    this.enabled = false;
    this.nextRunTime = null;

    this.initFromSettings();
    this.listenToOrchestrator();
  }

  initFromSettings() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        if (settings.autopilot) {
          this.intervalMinutes = settings.autopilot.intervalMinutes || 120;
          this.batchSize = settings.autopilot.batchSize || 10;
          this.enabled = !!settings.autopilot.enabled;
          if (this.enabled) {
            this.scheduleNext(10000); // Start after 10s if enabled on boot
          }
        }
      }
    } catch (e) {
      console.error('Error loading autopilot settings:', e);
    }
  }

  saveSettings() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        settings.autopilot = {
          enabled: this.enabled,
          intervalMinutes: this.intervalMinutes,
          batchSize: this.batchSize,
          nextRunTime: this.nextRunTime
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      }
    } catch (e) {
      console.error('Error saving autopilot settings:', e);
    }
  }

  listenToOrchestrator() {
    if (!this.orchestrator) return;

    this.orchestrator.on('cycle_finished', () => {
      if (this.enabled) {
        const ms = this.intervalMinutes * 60 * 1000;
        this.orchestrator.log(
          `⏱️ [Autopilot] 2-Hour Cooldown started. Next automatic batch of ${this.batchSize} jobs will trigger in ${this.intervalMinutes} minutes.`,
          'info'
        );
        this.scheduleNext(ms);
      }
    });
  }

  scheduleNext(delayMs) {
    if (this.timer) clearTimeout(this.timer);
    this.nextRunTime = Date.now() + delayMs;
    this.saveSettings();
    this.emitStatus();

    this.timer = setTimeout(async () => {
      if (!this.enabled) return;

      if (this.orchestrator.state === 'idle' || this.orchestrator.state === 'stopped') {
        this.orchestrator.log(
          `🚀 [Autopilot] 2-Hour Auto-Trigger activated! Searching and applying to next ${this.batchSize} jobs...`,
          'info'
        );
        await this.orchestrator.start();
      } else {
        this.orchestrator.log(
          `[Autopilot] Orchestrator currently busy (${this.orchestrator.state}). Postponing trigger by 10 minutes.`,
          'warn'
        );
        this.scheduleNext(10 * 60 * 1000);
      }
    }, delayMs);
  }

  start(intervalMinutes = 120, batchSize = 10) {
    this.enabled = true;
    this.intervalMinutes = Number(intervalMinutes) || 120;
    this.batchSize = Number(batchSize) || 10;

    this.orchestrator.log(
      `🟢 [Autopilot] 24/7 Autopilot Scheduler ENABLED: Will auto-apply to ${this.batchSize} jobs every ${this.intervalMinutes} minutes (${this.intervalMinutes / 60} hours).`,
      'success'
    );

    // If orchestrator is idle, trigger immediately
    if (this.orchestrator.state === 'idle' || this.orchestrator.state === 'stopped') {
      this.orchestrator.start();
    } else {
      this.scheduleNext(this.intervalMinutes * 60 * 1000);
    }

    this.saveSettings();
    this.emitStatus();
    return this.getStatus();
  }

  stop() {
    this.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunTime = null;
    this.saveSettings();
    this.orchestrator.log('🔴 [Autopilot] 24/7 Autopilot Scheduler DISABLED.', 'warn');
    this.emitStatus();
    return this.getStatus();
  }

  emitStatus() {
    this.emit('status', this.getStatus());
  }

  getStatus() {
    const remainingMs = this.nextRunTime ? Math.max(0, this.nextRunTime - Date.now()) : 0;
    const remainingMins = Math.floor(remainingMs / 60000);
    const remainingSecs = Math.floor((remainingMs % 60000) / 1000);

    return {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      batchSize: this.batchSize,
      nextRunTime: this.nextRunTime,
      countdownFormatted: this.enabled && this.nextRunTime
        ? `${remainingMins}m ${remainingSecs}s`
        : 'Inactive'
    };
  }
}

module.exports = AutopilotScheduler;
