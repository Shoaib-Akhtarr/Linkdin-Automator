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
