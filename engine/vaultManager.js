const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Store key and vault in LOCALAPPDATA (completely outside of OneDrive to avoid sync conflicts or cloud exposure)
const LOCAL_SECURE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\mshoa', 'AppData', 'Local'),
  'LinkdinAutomation'
);
const VAULT_FILE = path.join(LOCAL_SECURE_DIR, 'vault.json');
const SECURE_KEY_FILE = path.join(LOCAL_SECURE_DIR, 'vault.key');
const SECURE_DPAPI_KEY_FILE = path.join(LOCAL_SECURE_DIR, 'vault.key.dpapi');

/**
 * Windows DPAPI encryption helpers
 */
function protectWithDpapi(dataBuffer) {
  if (process.platform !== 'win32') return null;
  try {
    const b64Input = dataBuffer.toString('base64');
    const psScript = `
      Add-Type -AssemblyName System.Security
      $raw = [Convert]::FromBase64String('${b64Input}')
      $enc = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($enc)
    `;
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { encoding: 'utf8' });
    return Buffer.from(stdout.trim().split('\r\n').pop().trim(), 'base64');
  } catch (_) {
    return null;
  }
}

function unprotectWithDpapi(encryptedBuffer) {
  if (process.platform !== 'win32') return null;
  try {
    const b64Input = encryptedBuffer.toString('base64');
    const psScript = `
      Add-Type -AssemblyName System.Security
      $raw = [Convert]::FromBase64String('${b64Input}')
      $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($dec)
    `;
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { encoding: 'utf8' });
    return Buffer.from(stdout.trim().split('\r\n').pop().trim(), 'base64');
  } catch (_) {
    return null;
  }
}

class VaultManager {
  constructor() {
    this.ensureDirs();
    this.key = this.deriveOrCreateKey();
  }

  ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_SECURE_DIR)) {
      fs.mkdirSync(LOCAL_SECURE_DIR, { recursive: true });
    }

    // Migrate any legacy vault or key from OneDrive data folder to secure machine-isolated directory
    const legacyKeyFile = path.join(DATA_DIR, 'vault.key');
    if (fs.existsSync(legacyKeyFile)) {
      try {
        if (!fs.existsSync(SECURE_KEY_FILE)) {
          fs.copyFileSync(legacyKeyFile, SECURE_KEY_FILE);
        }
        fs.unlinkSync(legacyKeyFile);
      } catch (_) {}
    }

    const legacyVaultFile = path.join(DATA_DIR, 'vault.json');
    if (fs.existsSync(legacyVaultFile)) {
      try {
        if (!fs.existsSync(VAULT_FILE)) {
          fs.copyFileSync(legacyVaultFile, VAULT_FILE);
        }
        fs.unlinkSync(legacyVaultFile);
      } catch (_) {}
    }
  }

  /**
   * Derive key from environment passphrase or Windows DPAPI machine-isolated keyfile
   */
  deriveOrCreateKey() {
    // 1. Environment Passphrase Priority (VAULT_PASSPHRASE)
    if (process.env.VAULT_PASSPHRASE && process.env.VAULT_PASSPHRASE.trim().length >= 8) {
      return crypto.pbkdf2Sync(process.env.VAULT_PASSPHRASE.trim(), 'LinkdinAutomationVaultSalt', 100000, 32, 'sha256');
    }

    // 2. Windows DPAPI-protected key file in %LOCALAPPDATA%
    if (fs.existsSync(SECURE_DPAPI_KEY_FILE)) {
      try {
        const encrypted = fs.readFileSync(SECURE_DPAPI_KEY_FILE);
        const decrypted = unprotectWithDpapi(encrypted);
        if (decrypted && decrypted.length === 32) return decrypted;
      } catch (_) {}
    }

    // 3. Fallback to standard local machine key in %LOCALAPPDATA%
    if (fs.existsSync(SECURE_KEY_FILE)) {
      try {
        const stored = fs.readFileSync(SECURE_KEY_FILE);
        if (stored.length === 32) {
          // Opportunistically upgrade to DPAPI if on Windows
          const dpapiEnc = protectWithDpapi(stored);
          if (dpapiEnc) {
            try {
              fs.writeFileSync(SECURE_DPAPI_KEY_FILE, dpapiEnc);
              fs.unlinkSync(SECURE_KEY_FILE);
            } catch (_) {}
          }
          return stored;
        }
      } catch (_) {}
    }

    // 4. Generate fresh 32-byte machine key and store protected with DPAPI in %LOCALAPPDATA%
    const newKey = crypto.randomBytes(32);
    const dpapiEnc = protectWithDpapi(newKey);
    if (dpapiEnc) {
      try {
        fs.writeFileSync(SECURE_DPAPI_KEY_FILE, dpapiEnc);
        return newKey;
      } catch (_) {}
    }

    try {
      fs.writeFileSync(SECURE_KEY_FILE, newKey, { mode: 0o600 });
    } catch (_) {}
    return newKey;
  }

  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  }

  decrypt(ciphertext) {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
    try {
      const [ivHex, tagHex, dataHex] = ciphertext.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(dataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      return '';
    }
  }

  loadRawVault() {
    if (!fs.existsSync(VAULT_FILE)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  saveRawVault(vaultData) {
    try {
      fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), { mode: 0o600 });
      return true;
    } catch (err) {
      console.error('[VaultManager] Failed to save vault.json:', err.message);
      return false;
    }
  }

  /**
   * Extract standardized tenant key from any URL
   */
  getTenantKey(url) {
    if (!url) return 'generic';
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase();
    } catch (_) {
      return String(url).toLowerCase().split('/')[0];
    }
  }

  /**
   * Lookup active credentials for a given portal tenant
   */
  getCredentials(url) {
    const tenant = this.getTenantKey(url);
    const vault = this.loadRawVault();
    const entry = vault[tenant];
    if (!entry) return null;

    return {
      tenant,
      email: entry.email,
      password: this.decrypt(entry.passwordEncrypted),
      status: entry.status,
      totpSecret: entry.totpSecretEncrypted ? this.decrypt(entry.totpSecretEncrypted) : null,
      updatedAt: entry.updatedAt
    };
  }

  /**
   * Phase 1 of 2PC: Write pending credential intent before clicking Register
   */
  savePendingCredentials(url, { email, password, totpSecret = null }) {
    const tenant = this.getTenantKey(url);
    const vault = this.loadRawVault();
    vault[tenant] = {
      tenant,
      email,
      passwordEncrypted: this.encrypt(password),
      totpSecretEncrypted: totpSecret ? this.encrypt(totpSecret) : null,
      status: 'PENDING_REGISTRATION',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return this.saveRawVault(vault);
  }

  /**
   * Phase 2 of 2PC: Confirm credential activation after registration or successful sign-in
   */
  commitCredentials(url) {
    const tenant = this.getTenantKey(url);
    const vault = this.loadRawVault();
    if (vault[tenant]) {
      vault[tenant].status = 'ACTIVE_CREDENTIAL';
      vault[tenant].confirmedAt = new Date().toISOString();
      vault[tenant].updatedAt = new Date().toISOString();
      return this.saveRawVault(vault);
    }
    return false;
  }

  /**
   * Purge pending registration if policy or validation permanently rejected it
   */
  purgePendingCredentials(url) {
    const tenant = this.getTenantKey(url);
    const vault = this.loadRawVault();
    if (vault[tenant] && vault[tenant].status === 'PENDING_REGISTRATION') {
      delete vault[tenant];
      return this.saveRawVault(vault);
    }
    return false;
  }

  /**
   * Generate high-entropy policy-compliant password
   */
  generateCompliantPassword(customRequirements = {}) {
    const length = Math.max(14, customRequirements.minLength || 16);
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const specials = '!@#$%&*';

    let pwd = [
      uppers[crypto.randomInt(0, uppers.length)],
      lowers[crypto.randomInt(0, lowers.length)],
      digits[crypto.randomInt(0, digits.length)],
      specials[crypto.randomInt(0, specials.length)]
    ];

    const allChars = uppers + lowers + digits + specials;
    while (pwd.length < length) {
      pwd.push(allChars[crypto.randomInt(0, allChars.length)]);
    }

    // Shuffle
    for (let i = pwd.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }

    return pwd.join('');
  }

  /**
   * Compute RFC-6238 6-digit TOTP from base32 secret
   */
  generateTOTP(base32Secret) {
    if (!base32Secret) return null;
    try {
      const base32 = base32Secret.replace(/\s+/g, '').toUpperCase();
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';
      for (let i = 0; i < base32.length; i++) {
        const val = alphabet.indexOf(base32.charAt(i));
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
      }

      const bytes = [];
      for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substr(i, 8), 2));
      }
      const keyBuffer = Buffer.from(bytes);

      const epochSeconds = Math.floor(Date.now() / 1000);
      const timeStep = Math.floor(epochSeconds / 30);
      const timeBuffer = Buffer.alloc(8);
      timeBuffer.writeBigInt64BE(BigInt(timeStep));

      const hmac = crypto.createHmac('sha1', keyBuffer);
      hmac.update(timeBuffer);
      const digest = hmac.digest();

      const offset = digest[digest.length - 1] & 0xf;
      const code = (
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff)
      ) % 1000000;

      return String(code).padStart(6, '0');
    } catch (_) {
      return null;
    }
  }
}

module.exports = new VaultManager();
