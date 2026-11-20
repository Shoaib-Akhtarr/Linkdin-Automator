const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'public', 'app.js');
let appJs = fs.readFileSync(appPath, 'utf8');

const vaultJs = `
// ==========================================
// Universal Platform Credentials & Vault Logic
// ==========================================

async function loadVault() {
  const statusEl = document.getElementById('vaultOverallStatus');
  if (statusEl) statusEl.textContent = 'CHECKING...';

  try {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    if (!data) return;

    let configuredCount = 0;
    const platforms = ['otta', 'linkedin', 'wellfound', 'ycombinator', 'email', 'groq'];

    platforms.forEach(plat => {
      const info = data[plat];
      const dot = document.getElementById(\`status-dot-\${plat}\`);
      const badge = document.getElementById(\`status-badge-\${plat}\`);
      const emailInput = document.getElementById(\`vault-\${plat}-email\`);
      const passInput = document.getElementById(\`vault-\${plat}-pass\`);
      const apiInput = document.getElementById(\`vault-\${plat}-api\`);

      if (info && info.configured) {
        configuredCount++;
        if (dot) {
          dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50';
        }
        if (badge) {
          badge.textContent = 'CONFIGURED';
          badge.className = 'text-[10px] text-emerald-400 font-bold';
        }
        if (emailInput && info.email && !emailInput.value) {
          emailInput.value = info.email;
        }
        if (passInput && info.hasPassword && !passInput.value) {
          passInput.placeholder = '•••••••• (Stored Securely)';
        }
        if (apiInput && info.hasApiKey && !apiInput.value) {
          apiInput.placeholder = '•••••••••••••••• (Active)';
        }
      } else {
        if (dot) {
          dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
        }
        if (badge) {
          badge.textContent = 'SETUP REQUIRED';
          badge.className = 'text-[10px] text-amber-400';
        }
      }
    });

    if (statusEl) {
      statusEl.textContent = \`\${configuredCount}/\${platforms.length} ACTIVE\`;
      statusEl.className = configuredCount >= 3 
        ? 'px-2 py-0.5 rounded-[2px] bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold text-[11px]'
        : 'px-2 py-0.5 rounded-[2px] bg-amber-950 text-amber-400 border border-amber-800 font-bold text-[11px]';
    }
  } catch (err) {
    console.error('Error loading vault credentials:', err);
    if (statusEl) statusEl.textContent = 'OFFLINE';
  }
}

async function savePlatformCreds(platform) {
  const emailInput = document.getElementById(\`vault-\${platform}-email\`);
  const passInput = document.getElementById(\`vault-\${platform}-pass\`);
  const apiInput = document.getElementById(\`vault-\${platform}-api\`);
  const msgEl = document.getElementById(\`verify-msg-\${platform}\`);

  const payload = {
    email: emailInput ? emailInput.value.trim() : '',
    password: passInput ? passInput.value : '',
    apiKey: apiInput ? apiInput.value.trim() : ''
  };

  if (msgEl) {
    msgEl.textContent = 'Saving to DPAPI vault...';
    msgEl.className = 'text-[10px] text-ember';
  }

  try {
    const res = await fetch(\`/api/credentials/\${platform}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      if (msgEl) {
        msgEl.textContent = '✓ Saved in encrypted vault';
        msgEl.className = 'text-[10px] text-emerald-400';
      }
      setTimeout(loadVault, 400);
    } else {
      if (msgEl) {
        msgEl.textContent = \`✗ Error: \${result.error || 'Could not save'}\`;
        msgEl.className = 'text-[10px] text-rose-400';
      }
    }
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = \`✗ \${e.message}\`;
      msgEl.className = 'text-[10px] text-rose-400';
    }
  }
}

async function verifyPlatformCreds(platform) {
  const msgEl = document.getElementById(\`verify-msg-\${platform}\`);
  if (msgEl) {
    msgEl.textContent = 'Testing connection / session...';
    msgEl.className = 'text-[10px] text-steel animate-pulse';
  }

  try {
    const res = await fetch(\`/api/credentials/verify/\${platform}\`, { method: 'POST' });
    const result = await res.json();
    if (msgEl) {
      msgEl.textContent = result.message || (result.success ? '✓ Verified' : '✗ Verification failed');
      msgEl.className = result.success ? 'text-[10px] text-emerald-400 font-semibold' : 'text-[10px] text-amber-400';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = \`Verification note: \${err.message}\`;
      msgEl.className = 'text-[10px] text-amber-400';
    }
  }
}

// Attach vault reload button
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('btnRefreshVault');
  if (refreshBtn) refreshBtn.addEventListener('click', loadVault);

  // Hook tab switch
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-tab') === 'tab-vault') {
        loadVault();
      }
    });
  });
});
`;

if (!appJs.includes('loadVault')) {
  // Add loadVault() call in window.addEventListener('DOMContentLoaded')
  appJs = appJs.replace(
    /loadHistory\(\);/,
    'loadHistory();\r\n  loadVault();'
  );
  appJs = appJs + '\r\n' + vaultJs;
  fs.writeFileSync(appPath, appJs, 'utf8');
  console.log('✅ Added universal vault functions to public/app.js');
} else {
  console.log('loadVault already present in public/app.js');
}
