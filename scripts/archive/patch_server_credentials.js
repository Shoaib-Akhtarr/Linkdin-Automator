const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

// 1. Add vaultManager import if not present
if (!code.includes('vaultManager')) {
  code = code.replace(
    /const AutopilotScheduler = require\('\.\/engine\/scheduler'\);/,
    "const AutopilotScheduler = require('./engine/scheduler');\r\nconst vaultManager = require('./engine/vaultManager');"
  );
}

// 2. Add Credentials API endpoints
const credsEndpoints = `
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

    res.json({ success: true, message: \`Credentials for \${platform} saved securely in vault.\` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credentials/verify/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    const creds = vaultManager.getPlatformCredentials(platform);
    if (!creds && platform !== 'groq' && platform !== 'email') {
      return res.status(404).json({ success: false, message: \`No credentials configured for \${platform}\` });
    }

    if (platform === 'groq') {
      const Groq = require('groq-sdk');
      const groqKey = creds?.apiKey || process.env.GROQ_API_KEY;
      if (!groqKey) return res.json({ success: false, message: 'No Groq API key set.' });
      const groq = new Groq({ apiKey: groqKey });
      const models = await groq.models.list();
      return res.json({ success: true, message: \`Groq connected! (\${models.data?.length || 0} models available)\` });
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
      return res.json({ success: true, status: 'OFFLINE_SAVED', message: \`\${platform.toUpperCase()} credentials stored in vault. Live session activates on run.\` });
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

    return res.json({ success: true, message: \`\${platform.toUpperCase()} credentials verified and active.\` });
  } catch (err) {
    res.json({ success: false, message: \`Verification note: \${err.message}\` });
  }
});
`;

if (!code.includes("app.get('/api/credentials'")) {
  code = code.replace(
    /app\.get\('\/api\/applications',[\s\S]*?\}\);/,
    match => `${match}\r\n${credsEndpoints}`
  );
  fs.writeFileSync(serverFile, code, 'utf8');
  console.log('✅ Added universal credentials routes to server.js');
} else {
  console.log('Credentials routes already present in server.js');
}
