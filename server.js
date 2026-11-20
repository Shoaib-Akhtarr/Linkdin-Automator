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
const vaultManager = require('./engine/vaultManager');
const chromeProfileManager = require('./engine/chromeProfileManager');
const platformVerifier = require('./engine/platformVerifier');
const resumeParser = require('./engine/resumeParser');
const autoLoginEngine = require('./engine/autoLoginEngine');
const browserBridge = require('./engine/browserBridge');
const outreachGenerator = require('./engine/outreachGenerator');
const triAiEvaluator = require('./engine/triAiEvaluator');
const cloudAiGateway = require('./engine/cloudAiGateway');
const eligibilityEngine = require('./engine/eligibilityEngine');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const scheduler = new AutopilotScheduler(orchestrator);

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
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
orchestrator.on('client_message', data => broadcastEvent('client_message', data));
orchestrator.on('auth_challenge_required', data => broadcastEvent('auth_challenge_required', data));
autoLoginEngine.on('log', entry => broadcastEvent('log', { timestamp: new Date().toLocaleTimeString(), message: entry.text, type: entry.type || 'info' }));
autoLoginEngine.on('challenge_created', data => broadcastEvent('auth_challenge_required', data));
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
    const currentCredits = cloudAiGateway.getCachedCredits();
    if (typeof currentCredits === 'number' && currentCredits <= 0) {
      orchestrator.log('🛑 [Credit System] Start blocked: 0 credits remaining. Please top up your balance.', 'warn');
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits: You have 0 credits remaining. Please redeem a promo code or top up.'
      });
    }
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

// Comprehensive Performance KPIs & Metrics
app.get('/api/analytics/kpis', (req, res) => {
  try {
    const kpiPath = path.join(__dirname, 'data', 'weekly_performance_report.json');
    if (fs.existsSync(kpiPath)) {
      res.json(JSON.parse(fs.readFileSync(kpiPath, 'utf8')));
    } else {
      res.json({ message: 'KPI report not yet generated. Run npm run metrics to generate.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Universal Platform Credentials & Vault Endpoints
// ==========================================
app.get('/api/credentials', (req, res) => {
  try {
    const creds = vaultManager.getAllPlatformCredentials();
    res.json(creds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credentials/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    const { email, password, apiKey, extra } = req.body;
    vaultManager.savePlatformCredentials(platform, { email, password, apiKey, extra });
    
    // Also sync to process.env where relevant
    if (platform === 'groq' && apiKey) {
      process.env.GROQ_API_KEY = apiKey;
    }
    if (platform === 'email') {
      if (email) process.env.EMAIL_USER = email;
      if (password) process.env.EMAIL_PASS = password;
    }

    res.json({ success: true, message: `Credentials for ${platform} saved securely in vault.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credentials/verify/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    const creds = vaultManager.getPlatformCredentials(platform);
    if (!creds && platform !== 'groq' && platform !== 'email') {
      return res.status(404).json({ success: false, message: `No credentials configured for ${platform}` });
    }

    if (platform === 'groq') {
      const groqKey = creds?.apiKey || process.env.GROQ_API_KEY;
      if (!groqKey) return res.json({ success: false, message: 'No Groq API key set.' });
      const resModels = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` }
      });
      if (!resModels.ok) return res.json({ success: false, message: `Groq API check failed: HTTP ${resModels.status}` });
      const data = await resModels.json();
      return res.json({ success: true, message: `Groq connected! (${data.data?.length || 0} models available)` });
    }

    if (platform === 'email') {
      const emailUser = creds?.email || process.env.EMAIL_USER;
      const emailPass = creds?.password || process.env.EMAIL_PASS;
      if (!emailUser || !emailPass) return res.json({ success: false, message: 'Gmail email or app password missing.' });
      const { ImapFlow } = require('imapflow');
      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: emailUser, pass: emailPass },
        logger: false
      });
      await client.connect();
      await client.logout();
      return res.json({ success: true, message: 'Gmail IMAP authenticated successfully!' });
    }

    // Platform session check (Otta, LinkedIn, Wellfound, YC)
    const browserBridge = require('./engine/browserBridge');
    const isReachable = await browserBridge.isCdpReachable();
    if (!isReachable) {
      return res.json({ success: true, status: 'OFFLINE_SAVED', message: `${platform.toUpperCase()} credentials stored in vault. Live session activates on run.` });
    }

    const page = await browserBridge.getPage();
    if (platform === 'otta') {
      const isLogged = await orchestrator.ottaEngine.isLoggedIn(page);
      return res.json({ 
        success: isLogged, 
        status: isLogged ? 'ACTIVE_SESSION' : 'NEEDS_LOGIN', 
        message: isLogged ? 'Active Otta session verified!' : 'Credentials saved. Will authenticate during automation loop.' 
      });
    }

    return res.json({ success: true, message: `${platform.toUpperCase()} credentials verified and active.` });
  } catch (err) {
    res.json({ success: false, message: `Verification note: ${err.message}` });
  }
});


// ==========================================
// ==========================================
// ==========================================
// Autonomous Background Login & 2FA Endpoints
// ==========================================
app.post('/api/auth/auto-login', async (req, res) => {
  try {
    const { platform = 'linkedin', email, password } = req.body || {};
    const result = await autoLoginEngine.login(platform, { email, password });
    if (result.status === 'challenge_required') {
      broadcastEvent('auth_challenge_required', {
        platform,
        challengeType: result.challengeType,
        message: result.message
      });
    } else if (result.status === 'success') {
      broadcastEvent('platform_verified', { platform, verified: true });
      try { orchestrator.start(); } catch (_) {}
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/submit-code', async (req, res) => {
  try {
    const { platform = 'linkedin', code } = req.body || {};
    if (!code) {
      return res.status(400).json({ status: 'error', message: 'Verification code is required.' });
    }
    const result = await autoLoginEngine.submitChallengeCode(platform, code);
    if (result.status === 'success') {
      broadcastEvent('platform_verified', { platform, verified: true });
      try { orchestrator.start(); } catch (_) {}
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/auth/challenge/:platform', (req, res) => {
  const { platform } = req.params;
  const hasChallenge = autoLoginEngine.activeChallenges.has(platform.toLowerCase());
  res.json({ hasChallenge, platform });
});

// Standalone System, Onboarding & Chrome Profile Endpoints
// ==========================================

// 1. Get detected Chrome profiles
app.get('/api/system/chrome-profiles', (req, res) => {
  try {
    const profiles = chromeProfileManager.listProfiles();
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const currentProfile = settings.execution?.chromeProfile || (profiles.length > 0 ? profiles[0] : null);
    const isHeadless = settings.execution?.headless !== false;
    res.json({ profiles, currentProfile, isHeadless });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Save selected Chrome profile & headless option
app.post('/api/system/chrome-profile', (req, res) => {
  try {
    const { profileId, profileName, profileEmail, headless } = req.body;
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!settings.execution) settings.execution = {};
    settings.execution.chromeProfile = {
      dir: profileId || 'Default',
      name: profileName || profileId || 'Default',
      email: profileEmail || ''
    };
    if (typeof headless === 'boolean') {
      settings.execution.headless = headless;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    orchestrator.reloadSettings();
    res.json({ success: true, chromeProfile: settings.execution.chromeProfile, headless: settings.execution.headless });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Open Chrome directly to platform login page
app.post('/api/system/open-login', (req, res) => {
  try {
    const { platform } = req.body;
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const profileObj = settings.execution?.chromeProfile || { dir: 'Default', name: 'Default Profile' };
    const profileDir = profileObj.dir || 'Default';
    
    const loginUrls = {
      linkedin: 'https://www.linkedin.com/login',
      wellfound: 'https://wellfound.com/login',
      ycombinator: 'https://www.workatastartup.com/',
      otta: 'https://app.otta.com/login'
    };

    const targetUrl = loginUrls[platform] || 'https://www.linkedin.com/login';
    chromeProfileManager.openChromeForLogin(profileDir, targetUrl);
    res.json({ success: true, platform, profileDir, profileName: profileObj.name || profileDir, targetUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3a. Manually confirm platform login state
app.post('/api/system/confirm-login', (req, res) => {
  try {
    const { platform, confirmed } = req.body || {};
    if (!platform) return res.status(400).json({ error: 'Platform name is required' });
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!settings.auth) settings.auth = {};
    settings.auth[platform] = confirmed !== false;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    orchestrator.reloadSettings();
    res.json({ success: true, platform, auth: settings.auth });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Launch Chrome with debugging port enabled
app.post('/api/system/start-chrome-debug', async (req, res) => {
  try {
    const { killExisting, headless } = req.body || {};
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const profileDir = settings.execution?.chromeProfile?.dir || 'Default';
    const isHeadless = typeof headless === 'boolean' ? headless : (settings.execution?.headless !== false);
    await chromeProfileManager.launchChromeDebug(profileDir, isHeadless, !!killExisting);
    res.json({ success: true, profileDir, isHeadless });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Verify platform logins
app.get('/api/system/verify-logins', async (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const results = await platformVerifier.verifyAllPlatforms(settings);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Setup Status Check
app.get('/api/system/setup-status', (req, res) => {
  try {
    const resumePath = path.join(__dirname, 'assets', 'resume.pdf');
    const resumeExists = fs.existsSync(resumePath);
    
    let hasProfile = false;
    try {
      const p = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
      hasProfile = !!(p.personal?.fullName && p.personal?.email && p.personal?.phone);
    } catch (_) {}

    let hasJobs = false;
    let hasChromeProfile = false;
    try {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      hasJobs = Array.isArray(s.search?.keywords) && s.search.keywords.length > 0;
      hasChromeProfile = !!(s.execution?.chromeProfile?.dir);
    } catch (_) {}

    const isSetupComplete = resumeExists && hasProfile && hasJobs && hasChromeProfile;
    res.json({
      isSetupComplete,
      resumeExists,
      hasProfile,
      hasJobs,
      hasChromeProfile
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Upload CV and auto-parse
app.post('/api/resume/upload', async (req, res) => {
  try {
    const { fileData } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'No file data received' });
    }

    const parseResult = await resumeParser.saveAndParseResume(fileData);
    
    // Auto-update profile.json with extracted fields if available
    if (parseResult.extracted && Object.keys(parseResult.extracted).length > 0) {
      const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
      const ext = parseResult.extracted;
      if (ext.fullName) {
        profile.personal.fullName = ext.fullName;
        if (ext.firstName) profile.personal.firstName = ext.firstName;
        if (ext.lastName) profile.personal.lastName = ext.lastName;
      }
      if (ext.email) profile.personal.email = ext.email;
      if (ext.phone) profile.personal.phone = ext.phone;
      if (ext.linkedin) profile.personal.links.linkedin = ext.linkedin;
      if (ext.github) profile.personal.links.github = ext.github;
      if (ext.skills && ext.skills.length > 0) {
        if (!profile.workExperienceYears) profile.workExperienceYears = { total: 3, default: 2 };
        ext.skills.forEach(s => {
          if (!profile.workExperienceYears[s]) profile.workExperienceYears[s] = 2;
        });
      }
      fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
      questionEngine.reloadProfile();
    }

    // Auto-update search.keywords in settings.json with Groq generated job titles
    if (parseResult.generatedJobTitles && parseResult.generatedJobTitles.length > 0) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (!settings.search) settings.search = {};
      settings.search.keywords = parseResult.generatedJobTitles;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      orchestrator.reloadSettings();
    }

    const currentCredits = cloudAiGateway.getCachedCredits();
    res.json({ success: true, result: parseResult, credits: currentCredits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6b. Generate job titles from existing resume via Groq
app.post('/api/resume/generate-titles', async (req, res) => {
  try {
    const resumeTxtPath = path.join(__dirname, 'assets', 'resume.txt');
    let resumeText = '';
    if (fs.existsSync(resumeTxtPath)) {
      resumeText = fs.readFileSync(resumeTxtPath, 'utf8');
    }
    const titles = await resumeParser.generateJobTitlesWithGroq(resumeText);
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!settings.search) settings.search = {};
    settings.search.keywords = titles;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    orchestrator.reloadSettings();
    const currentCredits = cloudAiGateway.getCachedCredits();
    res.json({ success: true, titles, credits: currentCredits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Unified Multi-Platform Jobs API (Ashby, Greenhouse, Lever, Hacker News, Remote Boards, Wellfound)
// ==========================================
app.get('/api/ats/jobs', (req, res) => {
  try {
    const data = orchestrator.companyAtsEngine.loadAtsJobs();
    let jobs = Array.isArray(data.jobs) ? [...data.jobs] : [];

    const seenIds = new Set(jobs.map(j => j.jobId));
    const seenSignatures = new Set(jobs.map(j => `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`));

    // 1. Merge Direct Discovered ATS Jobs
    const discPath = path.join(__dirname, 'data', 'ats_discovered_jobs.json');
    if (fs.existsSync(discPath)) {
      try {
        const disc = JSON.parse(fs.readFileSync(discPath, 'utf8'));
        for (const j of (disc.jobs || [])) {
          const sig = `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`;
          if (!seenIds.has(j.jobId) && !seenSignatures.has(sig)) {
            jobs.push(j);
            seenIds.add(j.jobId);
            seenSignatures.add(sig);
          }
        }
      } catch (_) {}
    }

    // 2. Merge Hacker News "Who is Hiring" direct founder jobs
    const hnPath = path.join(__dirname, 'data', 'hn_discovered_jobs.json');
    if (fs.existsSync(hnPath)) {
      try {
        const hn = JSON.parse(fs.readFileSync(hnPath, 'utf8'));
        for (const j of (hn.jobs || [])) {
          const sig = `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`;
          if (!seenIds.has(j.jobId) && !seenSignatures.has(sig)) {
            jobs.push(j);
            seenIds.add(j.jobId);
            seenSignatures.add(sig);
          }
        }
      } catch (_) {}
    }

    // 3. Merge Remote Boards cached jobs (RemoteOK, Jobicy, WeWorkRemotely, Remotive)
    const rbPath = path.join(__dirname, 'data', 'remote_boards_jobs.json');
    if (fs.existsSync(rbPath)) {
      try {
        const rb = JSON.parse(fs.readFileSync(rbPath, 'utf8'));
        for (const j of (rb.jobs || [])) {
          const sig = `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`;
          if (!seenIds.has(j.jobId) && !seenSignatures.has(sig)) {
            jobs.push(j);
            seenIds.add(j.jobId);
            seenSignatures.add(sig);
          }
        }
      } catch (_) {}
    }
    if (orchestrator.remoteBoardsEngine && Array.isArray(orchestrator.remoteBoardsEngine.cachedJobs)) {
      for (const j of orchestrator.remoteBoardsEngine.cachedJobs) {
        const sig = `${(j.company || '').toLowerCase()}___${(j.title || '').toLowerCase()}`;
        if (!seenIds.has(j.jobId) && !seenSignatures.has(sig)) {
          jobs.push(j);
          seenIds.add(j.jobId);
          seenSignatures.add(sig);
        }
      }
    }

    // 3.5. Universal Profile-Driven Gate (Eligibility, Seniority & Startup Filter)
    // Synchronized 100% with Telemetry/Autopilot through EligibilityEngine
    jobs = jobs.filter(j => {
      const evalResult = eligibilityEngine.evaluateEligibility(j, { excludeSeniorLevels: true });
      return evalResult.eligible;
    });

    // 4. Enrich each job and cross-check against Application History (Tracker)
    const enriched = jobs.map(j => {
      const copy = { ...j };
      
      // Strict cross-check with applications.json
      const isAlreadyApplied = tracker.hasApplied(j) || copy.status === 'applied' || copy.status === 'previously_applied';
      copy.isApplied = Boolean(isAlreadyApplied);
      if (isAlreadyApplied) {
        copy.status = 'applied';
      }

      if (!copy.outreach) {
        copy.outreach = outreachGenerator.generateOutreach(j.company, j.title);
      }

      const evalData = triAiEvaluator.getCachedEvaluation(j.jobId);
      if (evalData) {
        copy.aiEvaluation = evalData;
      } else {
        copy.aiEvaluation = {
          jobId: j.jobId,
          consensusScore: null,
          consensusVerdict: 'Pending Tri-AI analysis...',
          recommendationTier: 'pending',
          beautifiedJd: triAiEvaluator.beautifyJd(j)
        };
      }
      return copy;
    });

    res.json({
      lastScanTime: data.lastScanTime || new Date().toISOString(),
      total: enriched.length,
      jobs: enriched
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to reset / clear all saved jobs to 0
app.post('/api/ats/clear-all-jobs', (req, res) => {
  try {
    const emptyAts = { lastScanTime: null, jobs: [] };
    const emptyDisc = { total: 0, scanned_at: null, jobs: [] };

    fs.writeFileSync(path.join(__dirname, 'data', 'ats_jobs.json'), JSON.stringify(emptyAts, null, 2));
    fs.writeFileSync(path.join(__dirname, 'data', 'ats_discovered_jobs.json'), JSON.stringify(emptyDisc, null, 2));
    fs.writeFileSync(path.join(__dirname, 'data', 'hn_discovered_jobs.json'), JSON.stringify(emptyDisc, null, 2));
    fs.writeFileSync(path.join(__dirname, 'data', 'pending_outreach.json'), JSON.stringify([], null, 2));
    fs.writeFileSync(path.join(__dirname, 'data', 'tri_ai_evaluations.json'), JSON.stringify({}, null, 2));

    try { fs.writeFileSync(path.join(__dirname, 'data', 'ats_discovered_jobs.csv'), ''); } catch (_) {}
    try { fs.writeFileSync(path.join(__dirname, 'data', 'hn_discovered_jobs.csv'), ''); } catch (_) {}

    if (orchestrator.remoteBoardsEngine) {
      orchestrator.remoteBoardsEngine.cachedJobs = [];
    }

    orchestrator.log('🗑️ [Portal] Reset all cached jobs. Job feed now has 0 saved jobs.', 'info');
    res.json({ success: true, message: 'All saved jobs cleared. Feed reset to 0.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ats/evaluate-job', async (req, res) => {
  const { jobId, forceRefresh } = req.body;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
  const job = (atsData.jobs || []).find(j => j.jobId === jobId);
  if (!job) return res.status(404).json({ error: 'Job not found in records' });

  try {
    const evaluation = await triAiEvaluator.evaluateJob(job, forceRefresh === true);
    res.json({ success: true, evaluation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ats/apply-now', async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId' });
  }

  const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
  const job = (atsData.jobs || []).find(j => j.jobId === jobId);
  if (!job) {
    return res.status(404).json({ error: `Job ${jobId} not found in ATS records` });
  }

  const currentCredits = cloudAiGateway.getCachedCredits();
  if (typeof currentCredits === 'number' && currentCredits <= 0) {
    orchestrator.log(`🛑 [1-Click ATS Apply Blocked] 0 credits remaining for "${job.title}" at "${job.company}".`, 'warn');
    return res.status(402).json({
      success: false,
      error: 'Insufficient credits: You have 0 credits remaining. Please top up your balance.'
    });
  }

  orchestrator.log(`⚡ [1-Click ATS Apply] Launching autonomous apply: "${job.title}" at "${job.company}" (${job.platform.toUpperCase()})`, 'info');
  
  job.status = 'applying';
  orchestrator.companyAtsEngine.saveAtsJobs(atsData);
  broadcastEvent('ats_job_update', job);

  try {
    const page = await browserBridge.getPage();
    const result = await orchestrator.companyAtsEngine.approveAndApply(jobId, page, {
      mode: 'autonomous',
      force: true,
      clearance: true,
      manualApproval: true,
      settings: orchestrator.settings,
      onStatusUpdate: msg => orchestrator.log(msg, 'info')
    });

    const updatedData = orchestrator.companyAtsEngine.loadAtsJobs();
    const updatedJob = (updatedData.jobs || []).find(j => j.jobId === jobId) || job;
    updatedJob.outreach = outreachGenerator.generateOutreach(updatedJob.company, updatedJob.title);
    broadcastEvent('ats_job_update', updatedJob);

    if (result?.status === 'applied') {
      const newBal = cloudAiGateway.deductCredits(5);
      orchestrator.log(`⚡ [Credit System] 5 credits used for ATS application to "${job.company}". Balance: ${newBal}`, 'info');
      broadcastEvent('credits_update', { credits: newBal });
    }

    res.json({
      success: result?.status === 'applied',
      status: updatedJob.status,
      message: result?.message || (result?.status === 'applied' ? 'Application submitted successfully!' : 'Completed with status: ' + updatedJob.status),
      job: updatedJob
    });
  } catch (err) {
    orchestrator.log(`❌ [1-Click ATS Apply Error] ${err.message}`, 'error');
    job.status = 'failed';
    job.failureReason = err.message;
    orchestrator.companyAtsEngine.saveAtsJobs(atsData);
    broadcastEvent('ats_job_update', job);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ats/refresh', (req, res) => {
  orchestrator.log('🔄 [Multi-Platform] Running universal job discovery across Startup ATS, Hacker News, and Remote Boards...', 'info');
  const atsScript = path.join(__dirname, 'scripts', 'ats_finder.py');
  const hnScript = path.join(__dirname, 'scripts', 'hn_hiring_finder.py');

  // Trigger Remote Boards fetch in parallel
  try {
    if (orchestrator.remoteBoardsEngine) {
      orchestrator.remoteBoardsEngine.searchJobs(orchestrator.settings, (msg) => orchestrator.log(msg, 'info'));
    }
  } catch (_) {}

  // Run ATS finder and HN finder
  exec(`python "${atsScript}" --sync && python "${hnScript}" --track auto --sync`, (err, stdout, stderr) => {
    if (err) {
      orchestrator.log(`⚠️ Discovery notice: ${err.message}`, 'warn');
    }
    const data = orchestrator.companyAtsEngine.loadAtsJobs();
    orchestrator.log(`✓ [Universal Discovery Complete] Synchronized multi-platform startup feed.`, 'success');
    broadcastEvent('ats_refreshed', { count: data.jobs?.length || 0 });
    res.json({ success: true, count: data.jobs?.length || 0 });
  });
});

app.get('/api/hn/jobs', (req, res) => {
  try {
    const hnPath = path.join(__dirname, 'data', 'hn_discovered_jobs.json');
    if (fs.existsSync(hnPath)) {
      const data = JSON.parse(fs.readFileSync(hnPath, 'utf8'));
      return res.json(data);
    }
    res.json({ total: 0, jobs: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hn/refresh', (req, res) => {
  const track = req.query.track || 'auto';
  orchestrator.log(`🚀 [Hacker News Discovery] Harvester fetching latest 'Who is hiring' thread (Track: ${track.toUpperCase()})...`, 'info');
  const pyScript = path.join(__dirname, 'scripts', 'hn_hiring_finder.py');
  exec(`python "${pyScript}" --track ${track} --sync`, (err, stdout, stderr) => {
    if (err) {
      orchestrator.log(`⚠️ HN discovery error: ${err.message}`, 'warn');
      return res.status(500).json({ error: err.message });
    }
    const hnPath = path.join(__dirname, 'data', 'hn_discovered_jobs.json');
    let count = 0;
    if (fs.existsSync(hnPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(hnPath, 'utf8'));
        count = data.jobs?.length || 0;
      } catch (_) {}
    }
    orchestrator.log(`✓ [HN Discovery Complete] Harvester captured ${count} roles with direct emails & portals.`, 'success');
    broadcastEvent('hn_refreshed', { count });
    res.json({ success: true, count });
  });
});

app.get('/api/ats/outreach', (req, res) => {
  const { company, role } = req.query;
  const outreach = outreachGenerator.generateOutreach(company, role);
  res.json(outreach);
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
    orchestrator.log('🔍 [Multi-Platform] Initiating comprehensive job scan across ATS & Remote feeds...', 'info');
    
    // 1. Direct Startup ATS Harvester (Ashby, Greenhouse, Lever)
    const atsResults = await orchestrator.companyAtsEngine.scanAllCompanies(orchestrator.settings, (msg) => {
      orchestrator.log(msg, 'info');
    });

    // 2. Curated Remote Tech Feeds (RemoteOK, Jobicy, WeWorkRemotely)
    try {
      if (orchestrator.remoteBoardsEngine) {
        orchestrator.log('📡 [Remote Boards] Fetching fresh listings from RemoteOK, Jobicy, and WeWorkRemotely...', 'info');
        await orchestrator.remoteBoardsEngine.searchJobs(orchestrator.settings, (msg) => orchestrator.log(msg, 'info'));
      }
    } catch (rErr) {
      orchestrator.log(`⚠️ Remote boards note: ${rErr.message}`, 'warning');
    }

    res.json({ success: true, results: atsResults });
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

// ─── Credit System Routes ────────────────────────────────────────────────────

// GET /api/credits/balance  — returns current credit balance for this device
app.get('/api/credits/balance', async (req, res) => {
  try {
    const result = await cloudAiGateway.getBalance();
    res.json(result);
  } catch (e) {
    res.status(500).json({ credits: 0, error: e.message });
  }
});

// POST /api/credits/redeem  — body: { code: "PROMO_CODE" }
app.post('/api/credits/redeem', async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing promo code' });
  }
  try {
    const result = await cloudAiGateway.redeemPromo(code.trim().toUpperCase());
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 LinkedIn Easy Apply Automation Control Dashboard`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Automatically open default browser once server is confirmed listening
  try {
    const { exec } = require('child_process');
    if (process.env.OPEN_BROWSER === 'true') { exec(`start http://localhost:${PORT}`, { windowsHide: true }); }
  } catch (e) {}

  // Auto-launch local Ollama engine in background if not already active
  try {
    const aiOptimizer = require('./engine/aiCvOptimizer');
    aiOptimizer.launchOllamaIfNeeded().catch(() => {});
  } catch (e) {}
});


// Auto-evaluate discovered ATS jobs in background with 3 AI models
async function runBackgroundAtsEvaluator() {
  try {
    const atsData = orchestrator.companyAtsEngine.loadAtsJobs();
    const jobs = atsData.jobs || [];
    for (const job of jobs.slice(0, 50)) {
      if (!triAiEvaluator.cache[job.jobId]) {
        await triAiEvaluator.evaluateJob(job);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (_) {}
}
setTimeout(runBackgroundAtsEvaluator, 2500);
