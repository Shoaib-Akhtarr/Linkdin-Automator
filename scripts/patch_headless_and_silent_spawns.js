const fs = require('fs');
const path = require('path');

// 1. Patch browserBridge.js -> Add --headless=new and windowsHide: true
const bridgePath = path.join(__dirname, '..', 'engine', 'browserBridge.js');
let bridgeCode = fs.readFileSync(bridgePath, 'utf8');

// Replace launchChromeIfNeeded spawn args
const oldSpawnBlock = `    console.log('Starting Google Chrome with remote debugging port 9222...');
    this.chromeProcess = spawn(
      CHROME_PATH,
      [
        '--remote-debugging-port=9222',
        \`--user-data-dir=\${userDataDir}\`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-quic',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-features=OptimizationHints,Translate,WebUIOmniboxPopup',
        'https://www.linkedin.com/jobs/'
      ],
      {
        detached: true,
        stdio: 'ignore'
      }
    );`;

const newSpawnBlock = `    console.log('Starting Headless Google Chrome daemon with remote debugging port 9222...');
    this.chromeProcess = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--remote-debugging-port=9222',
        \`--user-data-dir=\${userDataDir}\`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1440,900',
        '--mute-audio',
        '--disable-blink-features=AutomationControlled',
        '--disable-quic',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-features=OptimizationHints,Translate,WebUIOmniboxPopup',
        'https://www.linkedin.com/jobs/'
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    );`;

if (bridgeCode.includes(oldSpawnBlock)) {
  bridgeCode = bridgeCode.replace(oldSpawnBlock, newSpawnBlock);
  console.log('✅ Patched browserBridge.js with --headless=new and windowsHide: true (LF)');
} else {
  const crlfOld = oldSpawnBlock.replace(/\n/g, '\r\n');
  const crlfNew = newSpawnBlock.replace(/\n/g, '\r\n');
  if (bridgeCode.includes(crlfOld)) {
    bridgeCode = bridgeCode.replace(crlfOld, crlfNew);
    console.log('✅ Patched browserBridge.js with --headless=new and windowsHide: true (CRLF)');
  } else {
    // Regex fallback
    bridgeCode = bridgeCode.replace(
      /this\.chromeProcess = spawn\([\s\S]*?stdio: 'ignore'\s*\}\s*\);/,
      `this.chromeProcess = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--remote-debugging-port=9222',
        \`--user-data-dir=\${userDataDir}\`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1440,900',
        '--mute-audio',
        '--disable-blink-features=AutomationControlled',
        '--disable-quic',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-features=OptimizationHints,Translate,WebUIOmniboxPopup',
        'https://www.linkedin.com/jobs/'
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    );`
    );
    console.log('✅ Patched browserBridge.js via regex fallback');
  }
}
fs.writeFileSync(bridgePath, bridgeCode, 'utf8');

// 2. Patch aiCvOptimizer.js -> windowsHide: true for Ollama spawn
const aiPath = path.join(__dirname, '..', 'engine', 'aiCvOptimizer.js');
let aiCode = fs.readFileSync(aiPath, 'utf8');
aiCode = aiCode.replace(
  /const child = spawn\(defaultOllamaPath, \['serve'\], \{[\s\S]*?stdio: 'ignore',/,
  `const child = spawn(defaultOllamaPath, ['serve'], {\n        detached: true,\n        stdio: 'ignore',\n        windowsHide: true,`
);
fs.writeFileSync(aiPath, aiCode, 'utf8');
console.log('✅ Patched aiCvOptimizer.js with windowsHide: true for Ollama');

// 3. Patch server.js -> windowsHide: true for start URL execution
const serverPath = path.join(__dirname, '..', 'server.js');
let serverCode = fs.readFileSync(serverPath, 'utf8');
serverCode = serverCode.replace(
  /exec\(`start http:\/\/localhost:\$\{PORT\}`\);/,
  "exec(`start http://localhost:${PORT}`, { windowsHide: true });"
);
fs.writeFileSync(serverPath, serverCode, 'utf8');
console.log('✅ Patched server.js with windowsHide: true for browser opener');

// 4. Update config/settings.json -> execution.headless = true
const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.execution) settings.execution = {};
  settings.execution.headless = true;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  console.log('✅ Updated settings.json: execution.headless = true');
} catch (e) {
  console.warn('Could not update settings.json:', e.message);
}
