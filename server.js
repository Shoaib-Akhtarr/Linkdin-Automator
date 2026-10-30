const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

// Load local .env credentials
require('./engine/envLoader');

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const orchestrator = require('./engine/orchestrator');
const tracker = require('./engine/tracker');
const questionEngine = require('./engine/questionEngine');
const AutopilotScheduler = require('./engine/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const scheduler = new AutopilotScheduler(orchestrator);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tailored_cvs', express.static(path.join(__dirname, 'data', 'tailored_cvs')));

// Store active SSE clients
const sseClients = new Set();

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// Hook orchestrator events to SSE broadcast
orchestrator.on('log', entry => broadcastEvent('log', entry));
orchestrator.on('state_change', state => broadcastEvent('state_change', state));
orchestrator.on('stats_update', stats => broadcastEvent('stats_update', stats));
orchestrator.on('current_job', job => broadcastEvent('current_job', job));
orchestrator.on('screenshot', base64 => broadcastEvent('screenshot', base64));
scheduler.on('status', status => broadcastEvent('autopilot_status', status));

// SSE Endpoint for real-time frontend streaming
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial state on connection
  const initial = orchestrator.getStatus();
  initial.autopilot = scheduler.getStatus();
  res.write(`event: init\ndata: ${JSON.stringify(initial)}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Control APIs
app.get('/api/status', (req, res) => {
  res.json(orchestrator.getStatus());
});

app.post('/api/start', async (req, res) => {
  try {
    orchestrator.start();
    res.json({ success: true, state: orchestrator.state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pause', (req, res) => {
  orchestrator.pause();
  res.json({ success: true, state: orchestrator.state });
});

app.post('/api/stop', async (req, res) => {
  try {
    await orchestrator.stop();
    res.json({ success: true, state: orchestrator.state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approve', async (req, res) => {
  await orchestrator.approveApplication();
  res.json({ success: true });
});

app.post('/api/skip', async (req, res) => {
  await orchestrator.skipCurrentApplication();
  res.json({ success: true });
});

// Autopilot Scheduler Endpoints
app.get('/api/autopilot/status', (req, res) => {
  res.json(scheduler.getStatus());
});

app.post('/api/autopilot/start', (req, res) => {
  const { intervalMinutes, batchSize } = req.body || {};
  const status = scheduler.start(intervalMinutes || 120, batchSize || 10);
  res.json({ success: true, status });
});

app.post('/api/autopilot/stop', (req, res) => {
  const status = scheduler.stop();
  res.json({ success: true, status });
});

// Profile endpoints
const PROFILE_FILE = path.join(__dirname, 'config', 'profile.json');
app.get('/api/profile', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read profile.json' });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(req.body, null, 2));
    questionEngine.reloadProfile();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save profile.json' });
  }
});

// Settings endpoints
const SETTINGS_FILE = path.join(__dirname, 'config', 'settings.json');
app.get('/api/settings', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read settings.json' });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(req.body, null, 2));
    orchestrator.reloadSettings();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save settings.json' });
  }
});

// Platform endpoints
app.get('/api/platform', (req, res) => {
  res.json({ activePlatform: orchestrator.settings.activePlatform || 'all' });
});

app.post('/api/platform', (req, res) => {
  try {
    const { platform } = req.body;
    if (platform) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      data.activePlatform = platform;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
      orchestrator.reloadSettings();
      broadcastEvent('platform_change', { activePlatform: platform });
      return res.json({ success: true, activePlatform: platform });
    }
    res.status(400).json({ error: 'Platform name required' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Applications history
app.get('/api/applications', (req, res) => {
  const platform = req.query.platform || 'all';
  res.json(tracker.getAllApplications(platform));
});

// ==========================================
// Direct Company ATS Endpoints (Greenhouse, Lever, Ashby)
// ==========================================
app.get('/api/ats/jobs', (req, res) => {
  try {
    const data = orchestrator.companyAtsEngine.loadAtsJobs();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ats/companies', (req, res) => {
  try {
    const companies = orchestrator.companyAtsEngine.loadCompanies();
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ats/scan', async (req, res) => {
  try {
    const results = await orchestrator.companyAtsEngine.scanAllCompanies(orchestrator.settings, (msg) => {
      orchestrator.log(msg, 'info');
    });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Safe Human-in-the-Loop Review & Approval Endpoints
// ==========================================

// 1. GET Review Screen (Safe for Email Link Scanners - Never modifies state!)
app.get('/api/ats/review', (req, res) => {
  const { id: jobId, token } = req.query;
  if (!jobId || !token) {
    return res.status(400).send('<h3>400 Bad Request: Missing job ID or verification token.</h3>');
  }

  const isValidToken = orchestrator.companyAtsEngine.verifyApprovalToken(jobId, token);
  if (!isValidToken) {
    return res.status(403).send('<h3>403 Forbidden: Invalid or expired approval token.</h3>');
  }

  const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
  const job = atsData.jobs.find(j => j.jobId === jobId);

  if (!job) {
    return res.status(404).send('<h3>404 Not Found: Job not found in recorded listings.</h3>');
  }

  const isAlreadyApproved = job.status === 'approved_queued_for_apply' || job.status === 'applied';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Review Role: ${job.title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 16px; margin: 0; }
        .container { max-width: 580px; margin: auto; background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
        .badge { background: #3b82f6; color: white; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
        .metric-box { background: #0f172a; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
        .metric-title { font-size: 14px; color: #94a3b8; }
        .metric-value { font-size: 22px; font-weight: bold; color: #f8fafc; margin-top: 4px; }
        .btn-confirm { background: #16a34a; color: white; border: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; transition: background 0.2s; }
        .btn-confirm:hover { background: #15803d; }
        .btn-secondary { display: block; text-align: center; margin-top: 12px; color: #94a3b8; text-decoration: none; font-size: 14px; }
        .tag { display: inline-block; background: #334155; color: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0; }
        .warn-tag { background: #78350f; color: #fef3c7; }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span class="badge">${job.platform}</span>
          <span style="font-size: 13px; color: #94a3b8;">${job.location || 'Worldwide Remote'}</span>
        </div>
        <h2 style="margin: 0 0 6px; font-size: 22px;">${job.title}</h2>
        <div style="color: #cbd5e1; font-size: 15px; margin-bottom: 16px;">🏢 <strong>${job.company}</strong></div>

        <div class="metric-box">
          <div style="display: flex; justify-content: space-between;">
            <div>
              <div class="metric-title">Calibrated Match Score</div>
              <div class="metric-value">${job.score}%</div>
            </div>
            <div style="text-align: right;">
              <div class="metric-title">Experience Required</div>
              <div class="metric-value" style="font-size: 18px; color: #38bdf8;">${job.requiredYears ? `${job.requiredYears} Years` : 'Compatible'}</div>
            </div>
          </div>
          <div style="margin-top: 12px; font-size: 13px; color: #cbd5e1;">
            <strong>Verified Skills:</strong><br/>
            ${(job.verifiedSkills || []).map(s => `<span class="tag">${s}</span>`).join('') || '<span style="color:#64748b;">None mapped</span>'}
          </div>
          ${job.criticalGaps && job.criticalGaps.length ? `
            <div style="margin-top: 10px; font-size: 13px; color: #f59e0b;">
              <strong>Missing Prerequisites:</strong><br/>
              ${job.criticalGaps.map(g => `<span class="tag warn-tag">${g}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        ${isAlreadyApproved ? `
          <div style="background: #14532d; border: 1px solid #22c55e; padding: 14px; border-radius: 8px; text-align: center; color: #86efac; font-weight: 500;">
            ✓ This application is already approved and queued!
          </div>
        ` : `
          <form method="POST" action="/api/ats/approve">
            <input type="hidden" name="jobId" value="${job.jobId}">
            <input type="hidden" name="token" value="${token}">
            <button type="submit" class="btn-confirm">🚀 Confirm & Queue Application</button>
          </form>
        `}

        <a class="btn-secondary" href="${job.url}" target="_blank">View Original Job Description on Company Portal &rarr;</a>
      </div>
    </body>
    </html>
  `);
});

// 2. POST Approve Endpoint (Strict State Modification - Token Protected)
app.post('/api/ats/approve', async (req, res) => {
  const jobId = req.body?.jobId || req.query?.id;
  const token = req.body?.token || req.query?.token;

  if (!jobId || !token) {
    return res.status(400).json({ error: 'Missing jobId or approval token' });
  }

  const isValidToken = orchestrator.companyAtsEngine.verifyApprovalToken(jobId, token);
  if (!isValidToken) {
    return res.status(403).json({ error: 'Forbidden: Invalid approval token' });
  }

  const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
  const job = atsData.jobs.find(j => j.jobId === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found in ATS records' });
  }

  job.status = 'approved_queued_for_apply';
  orchestrator.companyAtsEngine.saveAtsJobs(atsData);
  orchestrator.log(`🚀 [ATS Human Confirmed] "${job.title}" at "${job.company}" marked approved for application!`, 'info');

  // If request came from HTML Form submit
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded') || !req.xhr) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Application Queued</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 60px 16px; text-align: center; }
          .card { max-width: 500px; margin: auto; background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; }
          h2 { color: #22c55e; margin-top: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✓ Application Confirmed & Queued!</h2>
          <p style="font-size: 18px; font-weight: 600; margin: 12px 0;">${job.title}</p>
          <p style="color: #94a3b8;">🏢 ${job.company} &bull; ${job.platform.toUpperCase()}</p>
          <p style="color: #cbd5e1; font-size: 14px; margin: 24px 0;">
            The role has been added to your approved queue. The automation engine will synthesize your tailored ATS resume and submit it during the next autopilot session.
          </p>
          <a href="${job.url}" target="_blank" style="color: #38bdf8; text-decoration: none; font-size: 14px;">View Original Posting &rarr;</a>
        </div>
      </body>
      </html>
    `);
  }

  res.json({ success: true, status: 'approved_queued_for_apply', job });
});

app.post('/api/ats/skip', (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
  const job = atsData.jobs.find(j => j.jobId === jobId);
  if (job) {
    job.status = 'skipped_by_user';
    orchestrator.companyAtsEngine.saveAtsJobs(atsData);
    orchestrator.log(`ℹ️ [ATS Dismissed] "${job.title}" at "${job.company}" dismissed by user.`, 'info');
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 LinkedIn Easy Apply Automation Control Dashboard`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Automatically open default browser once server is confirmed listening
  try {
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  } catch (e) {}

  // Auto-launch local Ollama engine in background if not already active
  try {
    const aiOptimizer = require('./engine/aiCvOptimizer');
    aiOptimizer.launchOllamaIfNeeded().catch(() => {});
  } catch (e) {}
});
