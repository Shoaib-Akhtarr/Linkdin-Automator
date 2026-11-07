/**
 * Gmail Monitor — IMAP inbox scanner
 *
 * Polls Gmail every 5 minutes. Detects:
 *   1. "Quota full / position filled / no longer accepting" → marks company as GHOST_QUOTA_FULL in tracker
 *   2. "Interview request / interested in your profile" → logs as INTERVIEW_REQUEST, emits alert
 *   3. "Application received / under review" → updates status to ACKNOWLEDGED
 *
 * Runs silently in background. Any error is caught and logged — never crashes the main loop.
 */

'use strict';

const { ImapFlow } = require('imapflow');
const path = require('path');
const fs = require('fs');
const tracker = require('./tracker');
require('./envLoader');

// ─── Config ──────────────────────────────────────────────────────────────────
const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const IMAP_USER = process.env.EMAIL_USER || 'onlyshoaib158@gmail.com';
const IMAP_PASS = process.env.EMAIL_PASS;                      // App Password from .env
const POLL_INTERVAL_MS = 5 * 60 * 1000;                        // 5 minutes
const SCAN_DAYS_BACK = 30;                                      // Look back 30 days
const LOG_FILE = path.join(__dirname, '..', 'data', 'gmail_monitor_log.json');
const PROCESSED_IDS_FILE = path.join(__dirname, '..', 'data', 'gmail_processed_uids.json');

// ─── Signal Patterns ─────────────────────────────────────────────────────────

/** Ghost / Quota-Full signals — these companies have frozen hiring */
const GHOST_PATTERNS = [
  /quota.{0,20}full/i,
  /position.{0,30}(filled|no longer available|has been filled)/i,
  /no longer accepting/i,
  /hiring.{0,20}(freeze|frozen|paused|on hold)/i,
  /not moving forward/i,
  /we('ve| have) decided to (close|pause|put on hold)/i,
  /position.{0,20}closed/i,
  /role.{0,20}(filled|closed|no longer)/i,
  /we.{0,20}(filled|closed) this (position|role|opening)/i,
  /unfortunately.{0,80}(filled|no longer|closed|paused)/i,
  /not pursuing.{0,30}application/i,
  /decided not to move forward/i,
];

/** Interview / Positive signals */
const INTERVIEW_PATTERNS = [
  /interview/i,
  /schedule.{0,20}(a |your |the )?(call|meeting|chat|interview)/i,
  /interested in your (profile|background|experience)/i,
  /would like to (speak|connect|chat|talk)/i,
  /move.{0,20}forward with you/i,
  /next (step|round|stage)/i,
  /technical (assessment|test|screen)/i,
  /coding (challenge|test|assessment)/i,
];

/** Acknowledgement signals — received but no decision yet */
const ACK_PATTERNS = [
  /application.{0,30}(received|submitted|confirmed)/i,
  /we('ve| have) received your (application|resume|CV)/i,
  /thank you for (applying|your application|your interest)/i,
  /under review/i,
  /reviewing your (application|profile)/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadProcessedUIDs() {
  try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8')));
    }
  } catch (_) {}
  return new Set();
}

function saveProcessedUIDs(set) {
  try {
    // Keep only last 5000 UIDs to prevent file bloat
    const arr = Array.from(set).slice(-5000);
    fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(arr, null, 2));
  } catch (_) {}
}

function appendLog(entry) {
  try {
    let log = [];
    if (fs.existsSync(LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
    log.unshift({ ...entry, scannedAt: new Date().toISOString() });
    // Keep last 500 entries
    if (log.length > 500) log = log.slice(0, 500);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  } catch (_) {}
}

/**
 * Extract company name from email subject / sender
 * e.g. "Your application at Acme Corp" → "Acme Corp"
 */
function extractCompany(subject, from) {
  if (!subject) return null;

  const patterns = [
    /(?:at|from|with|to|@)\s+([A-Z][a-zA-Z0-9\s&.,'-]{2,40}?)(?:\s*[-–|,]|\s+(?:is|has|are|we|team)|$)/,
    /^([A-Z][a-zA-Z0-9\s&.,'-]{2,30}?)(?:\s*[-–|:]|\s+(?:is|has|are|we|team))/,
  ];

  for (const p of patterns) {
    const m = subject.match(p);
    if (m && m[1] && m[1].length > 2) return m[1].trim();
  }

  // Fallback: extract domain from sender email
  if (from) {
    const domainMatch = from.match(/@([a-zA-Z0-9-]+)\./);
    if (domainMatch) return domainMatch[1];
  }

  return null;
}

/**
 * Classify a single email
 */
function classifyEmail(subject, body, from) {
  const text = `${subject || ''} ${body || ''}`;

  for (const p of GHOST_PATTERNS) {
    if (p.test(text)) return { type: 'GHOST_QUOTA_FULL', pattern: p.toString() };
  }
  for (const p of INTERVIEW_PATTERNS) {
    if (p.test(text)) return { type: 'INTERVIEW_REQUEST', pattern: p.toString() };
  }
  for (const p of ACK_PATTERNS) {
    if (p.test(text)) return { type: 'ACKNOWLEDGED', pattern: p.toString() };
  }

  return { type: 'UNRELATED' };
}

// ─── Core Scanner ─────────────────────────────────────────────────────────────

class GmailMonitor {
  constructor(emitter = null) {
    this.emitter = emitter;      // Orchestrator EventEmitter (optional) for live alerts
    this.running = false;
    this.pollTimer = null;
    this.stats = {
      lastScan: null,
      ghostsFound: 0,
      interviewsFound: 0,
      acksFound: 0,
      emailsScanned: 0,
    };
  }

  /** Start continuous monitoring */
  start(emitter = null) {
    if (this.running) return;
    if (emitter) this.emitter = emitter;
    this.running = true;

    console.log('[GmailMonitor] Starting — polling every 5 minutes');
    this._scan().catch(e => console.error('[GmailMonitor] First scan error:', e.message));

    this.pollTimer = setInterval(() => {
      this._scan().catch(e => console.error('[GmailMonitor] Scan error:', e.message));
    }, POLL_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    console.log('[GmailMonitor] Stopped');
  }

  getStats() {
    return { ...this.stats };
  }

  /** Main scan logic */
  async _scan() {
    if (!IMAP_PASS) {
      console.warn('[GmailMonitor] EMAIL_PASS not set in .env — skipping scan');
      return;
    }

    const processedUIDs = loadProcessedUIDs();
    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: true,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false,  // Suppress verbose IMAP logs
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      // Build date filter: look back SCAN_DAYS_BACK days
      const since = new Date();
      since.setDate(since.getDate() - SCAN_DAYS_BACK);
      const sinceStr = since.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

      // Search for job-related emails only
      const searchCriteria = {
        since,
        or: [
          { subject: 'application' },
          { subject: 'position' },
          { subject: 'role' },
          { subject: 'opportunity' },
          { subject: 'interview' },
          { subject: 'hiring' },
          { subject: 'thank you for applying' },
          { subject: 'applied' },
        ]
      };

      let newGhosts = 0;
      let newInterviews = 0;
      let newAcks = 0;
      let scanned = 0;

      for await (const msg of client.fetch(searchCriteria, {
        uid: true,
        envelope: true,
        bodyStructure: true,
        source: true,
      })) {
        const uid = String(msg.uid);
        if (processedUIDs.has(uid)) continue;

        scanned++;
        processedUIDs.add(uid);

        try {
          // Parse email source
          const raw = msg.source ? msg.source.toString('utf8') : '';
          const subject = msg.envelope?.subject || '';
          const from = msg.envelope?.from?.[0]?.address || '';

          // Extract plain text body (strip HTML tags)
          const bodyText = raw
            .replace(/<[^>]+>/g, ' ')
            .replace(/=\r?\n/g, '')    // decode quoted-printable soft wraps
            .slice(0, 3000);           // only need first 3KB for classification

          const classification = classifyEmail(subject, bodyText, from);

          if (classification.type === 'UNRELATED') continue;

          const company = extractCompany(subject, from);

          const logEntry = {
            uid,
            type: classification.type,
            subject: subject.slice(0, 100),
            from,
            company,
            pattern: classification.pattern,
          };

          appendLog(logEntry);

          // ── Act on classification ──────────────────────────────────────────

          if (classification.type === 'GHOST_QUOTA_FULL' && company) {
            // Find matching applied job in tracker and mark it
            const applied = tracker.data?.applications?.filter(a =>
              a.status && (a.status.toLowerCase().includes('applied') || a.status === 'ACKNOWLEDGED') &&
              tracker.cleanText(a.company).includes(tracker.cleanText(company).slice(0, 8))
            );

            if (applied && applied.length > 0) {
              for (const app of applied) {
                tracker.recordOutcome(
                  { jobId: app.jobId, company: app.company, title: app.title, platform: app.platform },
                  'GHOST_QUOTA_FULL',
                  {
                    notes: `Gmail detected: "${subject.slice(0, 80)}" — quota full / position closed`,
                    stage: 'email_response',
                    gmailUID: uid,
                  }
                );
                console.log(`[GmailMonitor] 👻 Ghost marked: ${app.company} — ${app.title}`);
              }
            } else {
              // Record ghost even without prior application record
              tracker.recordOutcome(
                { jobId: `gmail_${uid}`, company: company, title: 'Unknown Role', platform: 'email' },
                'GHOST_QUOTA_FULL',
                { notes: `Gmail: "${subject.slice(0, 80)}"`, stage: 'email_response', gmailUID: uid }
              );
            }

            newGhosts++;
            this.stats.ghostsFound++;

            // Emit live alert if orchestrator attached
            if (this.emitter) {
              this.emitter.emit('log', {
                timestamp: new Date().toLocaleTimeString(),
                message: `📧 Ghost detected via Gmail: "${company}" — quota/position closed`,
                type: 'warning'
              });
            }
          }

          else if (classification.type === 'INTERVIEW_REQUEST' && company) {
            // Find matching job and update status
            const applied = tracker.data?.applications?.find(a =>
              tracker.cleanText(a.company).includes(tracker.cleanText(company).slice(0, 8))
            );

            if (applied) {
              tracker.recordOutcome(
                { jobId: applied.jobId, company: applied.company, title: applied.title, platform: applied.platform },
                'INTERVIEW_REQUEST',
                { notes: `Gmail: "${subject.slice(0, 80)}"`, stage: 'interview_stage', gmailUID: uid }
              );
            }

            newInterviews++;
            this.stats.interviewsFound++;

            // 🔔 Strong alert — user must see this
            if (this.emitter) {
              this.emitter.emit('log', {
                timestamp: new Date().toLocaleTimeString(),
                message: `🎉 INTERVIEW REQUEST from "${company || from}"! Subject: "${subject.slice(0, 60)}"`,
                type: 'success'
              });
            }

            console.log(`[GmailMonitor] 🎉 INTERVIEW REQUEST: ${company} — "${subject}"`);
          }

          else if (classification.type === 'ACKNOWLEDGED' && company) {
            const applied = tracker.data?.applications?.find(a =>
              (a.status?.toLowerCase().includes('applied')) &&
              tracker.cleanText(a.company).includes(tracker.cleanText(company).slice(0, 8))
            );

            if (applied && applied.status !== 'ACKNOWLEDGED' && applied.status !== 'INTERVIEW_REQUEST') {
              tracker.recordOutcome(
                { jobId: applied.jobId, company: applied.company, title: applied.title, platform: applied.platform },
                'ACKNOWLEDGED',
                { notes: `Gmail: "${subject.slice(0, 80)}"`, stage: 'acknowledged', gmailUID: uid }
              );
            }

            newAcks++;
            this.stats.acksFound++;
          }

        } catch (msgErr) {
          // Per-message errors must not kill the loop
          console.warn(`[GmailMonitor] Error parsing UID ${uid}:`, msgErr.message);
        }
      }

      // Save processed UIDs
      saveProcessedUIDs(processedUIDs);

      this.stats.lastScan = new Date().toISOString();
      this.stats.emailsScanned += scanned;

      if (scanned > 0) {
        console.log(`[GmailMonitor] ✅ Scan done: ${scanned} new emails | 👻 ${newGhosts} ghosts | 🎉 ${newInterviews} interviews | 📨 ${newAcks} acks`);
      }

    } catch (err) {
      console.error('[GmailMonitor] IMAP connection error:', err.message);
    } finally {
      try { await client.logout(); } catch (_) {}
    }
  }
}

module.exports = GmailMonitor;
