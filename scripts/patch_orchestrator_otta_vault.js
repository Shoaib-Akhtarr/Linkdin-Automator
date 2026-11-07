const fs = require('fs');
const path = require('path');

const orchPath = path.join(__dirname, '..', 'engine', 'orchestrator.js');
let code = fs.readFileSync(orchPath, 'utf8');

// Ensure vaultManager is imported
if (!code.includes("require('./vaultManager')")) {
  code = code.replace(
    /const tracker = require\('\.\/tracker'\);/,
    "const tracker = require('./tracker');\r\nconst vaultManager = require('./vaultManager');"
  );
}

// Enhance Otta login check with Vault auto-login
const target = `    let isLogged = await this.ottaEngine.isLoggedIn(page);
    if (!isLogged) {
      const isAutonomous = this.settings.execution?.mode === 'autonomous';`;

const replacement = `    let isLogged = await this.ottaEngine.isLoggedIn(page);
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
      const isAutonomous = this.settings.execution?.mode === 'autonomous';`;

if (!code.includes('Attempting autonomous login via Vault credentials')) {
  // Try CRLF match
  const crlfTarget = target.replace(/\n/g, '\r\n');
  const crlfReplacement = replacement.replace(/\n/g, '\r\n');
  if (code.includes(crlfTarget)) {
    code = code.replace(crlfTarget, crlfReplacement);
    fs.writeFileSync(orchPath, code, 'utf8');
    console.log('✅ Added Otta Vault auto-login to orchestrator.js (CRLF)');
  } else if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync(orchPath, code, 'utf8');
    console.log('✅ Added Otta Vault auto-login to orchestrator.js (LF)');
  } else {
    console.warn('Target not matched in orchestrator.js');
  }
} else {
  console.log('Otta Vault auto-login already present in orchestrator.js');
}
