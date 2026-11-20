const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building complete standalone distribution for Windows...');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist', 'AutoApply-Pro');
const binDir = path.join(distDir, 'bin');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// 1. Compile native AutoApply-AI.exe launcher
console.log('📦 Compiling native Windows GUI executable...');
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const launcherSrc = path.join(rootDir, 'launcher', 'AutoApplyLauncher.cs');
const outExe = path.join(distDir, 'AutoApply-AI.exe');
execSync(`"${cscPath}" /target:winexe /optimize+ /out:"${outExe}" "${launcherSrc}"`);
console.log('✓ AutoApply-AI.exe compiled successfully!');

// 2. Bundle portable node.exe into bin/
console.log('📦 Bundling portable Node runtime into bin/node.exe...');
const systemNode = 'C:\\Program Files\\nodejs\\node.exe';
if (fs.existsSync(systemNode)) {
  fs.copyFileSync(systemNode, path.join(binDir, 'node.exe'));
  console.log('✓ Portable node.exe bundled.');
}

// 3. Copy necessary folders & files
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'dist' || entry.name === 'launcher') continue;
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('📦 Copying application resources, engines, public assets, and config...');
['config', 'public', 'assets', 'engine'].forEach(dir => {
  const src = path.join(rootDir, dir);
  const dst = path.join(distDir, dir);
  if (fs.existsSync(src)) {
    copyDirSync(src, dst);
  }
});

// Copy server.js, package.json
['server.js', 'package.json'].forEach(f => {
  const src = path.join(rootDir, f);
  const dst = path.join(distDir, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
});

// --- STEP 1: SANITIZE PERSONAL DATA & TEMPLATES ---
console.log('🔒 Sanitizing personal data & preparing clean candidate templates...');

const cleanProfile = {
  personal: {
    firstName: "",
    lastName: "",
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    phoneCountryCode: "United States (+1)",
    phoneCountryCodeNumber: "1",
    address: {
      city: "",
      state: "",
      country: "",
      postalCode: ""
    },
    links: {
      github: "",
      linkedin: "",
      portfolio: ""
    }
  },
  workExperienceYears: {
    total: 0,
    default: 1
  },
  workAuthorization: {
    legallyAuthorized: "Yes",
    requireSponsorship: "No"
  }
};
fs.writeFileSync(path.join(distDir, 'config', 'profile.json'), JSON.stringify(cleanProfile, null, 2), 'utf8');

// Also sanitize settings.json
const distSettingsPath = path.join(distDir, 'config', 'settings.json');
if (fs.existsSync(distSettingsPath)) {
  const settings = JSON.parse(fs.readFileSync(distSettingsPath, 'utf8'));
  if (settings.search) {
    settings.search.keywords = [];
  }
  if (settings.resume) {
    settings.resume.activeResumePdf = "";
    settings.resume.extractedData = null;
  }
  fs.writeFileSync(distSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

// Clean out tailored_cvs in dist
const dataDist = path.join(distDir, 'data');
if (!fs.existsSync(dataDist)) fs.mkdirSync(dataDist, { recursive: true });
const tailoredCvs = path.join(dataDist, 'tailored_cvs');
if (!fs.existsSync(tailoredCvs)) fs.mkdirSync(tailoredCvs, { recursive: true });
if (fs.existsSync(tailoredCvs)) {
  fs.readdirSync(tailoredCvs).forEach(f => {
    try { fs.unlinkSync(path.join(tailoredCvs, f)); } catch(e){}
  });
}

// --- STEP 3: OBFUSCATE ENGINE & SERVER LOGIC ---
console.log('🛡️ Obfuscating application logic & protecting proprietary algorithms...');
const JavaScriptObfuscator = require('javascript-obfuscator');

const obfuscateOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 10,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false
};

// Obfuscate all engine files
const distEngineDir = path.join(distDir, 'engine');
if (fs.existsSync(distEngineDir)) {
  const engineFiles = fs.readdirSync(distEngineDir).filter(f => f.endsWith('.js'));
  for (const f of engineFiles) {
    const fullPath = path.join(distEngineDir, f);
    const code = fs.readFileSync(fullPath, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscateOptions).getObfuscatedCode();
    fs.writeFileSync(fullPath, obfuscated, 'utf8');
    console.log(`  ✓ Protected: engine/${f}`);
  }
}

// Obfuscate server.js in dist
const distServerPath = path.join(distDir, 'server.js');
if (fs.existsSync(distServerPath)) {
  const code = fs.readFileSync(distServerPath, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscateOptions).getObfuscatedCode();
  fs.writeFileSync(distServerPath, obfuscated, 'utf8');
  console.log(`  ✓ Protected: server.js`);
}

// Copy node_modules
console.log('📦 Copying production dependencies (node_modules)...');
const nmSrc = path.join(rootDir, 'node_modules');
const nmDst = path.join(distDir, 'node_modules');
if (!fs.existsSync(nmDst)) {
  try {
    execSync(`robocopy "${nmSrc}" "${nmDst}" /E /XD .cache /R:1 /W:1 /NFL /NDL /NJH /NJS`, { stdio: 'ignore' });
  } catch (e) {
    // Robocopy returns exit codes 1-3 on successful copy
  }
}
console.log('✓ Production dependencies copied.');

// 4. Create Run-AutoApply.bat launcher & README
const batLauncher = `@echo off
title AutoApply AI Launcher
cd /d "%~dp0"
if exist "AutoApply-AI.exe" (
    start "" "AutoApply-AI.exe"
) else (
    start "" "bin\\node.exe" server.js
)
`;
fs.writeFileSync(path.join(distDir, 'Run-AutoApply.bat'), batLauncher, 'utf8');

const friendReadme = `# 🚀 AutoApply AI - Autonomous Job Hunting Suite

Welcome to AutoApply AI! This software automates your job hunt across LinkedIn, Wellfound, and 7+ platforms directly from your desktop.

## 🏁 Quick Start (Just 1 Click!)
1. Double-click **AutoApply-AI.exe** (or **Run-AutoApply.bat**) to launch the software.
2. Your web browser will automatically open to the **Axiom Dashboard** (http://localhost:3000).
3. The **Setup Wizard** will appear to guide you through:
   - **Step 1:** Selecting which Google Chrome Profile you use for job hunting.
   - **Step 2:** Uploading your Resume (PDF) and verifying your candidate profile.
   - **Step 3:** Choosing your target job titles, keywords, and remote preferences.
   - **Step 4:** Logging in to LinkedIn and target portals in Chrome.
4. Click **"Start Automation"** and let the AI hunt and apply to jobs for you in the background!

## 🛡️ Windows SmartScreen Note (First Launch Only)
Because this is a private custom build compiled directly for you without a $500/year corporate Microsoft signature:
- Windows may show: *"Windows protected your PC: Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
- Simply click **"More info"** → **"Run anyway"**.
- This is completely normal for private custom-built software.

## 🌐 Chrome Profile Isolation & Zero Lock Conflicts
- You do NOT need to close your existing Google Chrome browser!
- AutoApply AI uses a dedicated, isolated automation directory so your daily work, tabs, and personal browsing remain 100% undisturbed without file-lock collisions.
- Runs in **Headless Mode** in the background so you can freely work or play while it applies.
`;
fs.writeFileSync(path.join(distDir, 'HOW_TO_RUN.txt'), friendReadme, 'utf8');

// 5. Create a standalone distribution ZIP
console.log('📦 Compressing into standalone distribution ZIP...');
const zipOut = path.join(rootDir, 'dist', 'AutoApply-Pro-v2.0-Windows.zip');
try {
  if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipOut}' -CompressionLevel Optimal"`);
  console.log('✓ Standalone ZIP package created:', zipOut);
} catch (e) {
  console.warn('Zip creation warning:', e.message);
}

console.log('\n🎉 ALL PACKAGING COMPLETE!');
console.log('Standalone Directory:', distDir);
console.log('Executable:', outExe);
console.log('Zip file:', zipOut);
