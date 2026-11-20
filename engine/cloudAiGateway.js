const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Cloud AI Gateway Connector (Gemini-Grade Security)
 * Proxies AI calls through the Cloudflare Worker Gateway with:
 * - Hardware Device Fingerprinting
 * - HMAC-SHA256 Request Signing
 * - Replay Attack Timestamp Validation
 * - Zero local API key exposure
 * - Local Persistent Credit Ledger (protects against serverless cold-start resets)
 */
class CloudAiGateway {
  constructor() {
    this.endpoint = process.env.AI_GATEWAY_URL || 'https://small-frog-1d12.onlyshoaib158.workers.dev';
    this.licenseKey = process.env.APP_LICENSE_KEY || 'AutoApply-VIP-Pass-2026';
    this.deviceFingerprint = this.generateDeviceFingerprint();
    this.enabled = true;

    this.creditsFile = path.join(__dirname, '..', 'data', 'credits.json');
    this.cachedCredits = this.loadLocalCredits();
  }

  generateDeviceFingerprint() {
    try {
      const raw = `${os.hostname()}-${os.userInfo().username}-${os.arch()}-${os.platform()}`;
      return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
    } catch (_) {
      return 'desktop-client-generic';
    }
  }

  loadLocalCredits() {
    try {
      if (fs.existsSync(this.creditsFile)) {
        const raw = fs.readFileSync(this.creditsFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data.credits === 'number') {
          return data.credits;
        }
      }
    } catch (_) {}
    return 25; // Default starter credits
  }

  saveLocalCredits(credits) {
    try {
      const dir = path.dirname(this.creditsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.creditsFile,
        JSON.stringify({
          credits,
          deviceFingerprint: this.deviceFingerprint,
          lastUpdated: new Date().toISOString()
        }, null, 2),
        'utf8'
      );
    } catch (e) {
      console.warn('[CloudAiGateway] Could not save local credits:', e.message);
    }
  }

  getCachedCredits() {
    return this.cachedCredits;
  }

  hasCredits(cost = 1) {
    return typeof this.cachedCredits === 'number' && this.cachedCredits >= cost;
  }

  deductCredits(amount = 5) {
    this.cachedCredits = Math.max(0, this.cachedCredits - amount);
    this.saveLocalCredits(this.cachedCredits);
    return this.cachedCredits;
  }

  createSignature(timestamp) {
    return crypto
      .createHmac('sha256', this.licenseKey)
      .update(`${this.deviceFingerprint}:${timestamp}`)
      .digest('hex');
  }

  async _signedPost(path, body) {
    const timestamp = Date.now().toString();
    const signature = this.createSignature(timestamp);
    const url = `${this.endpoint}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-License': this.licenseKey,
        'X-Client-Fingerprint': this.deviceFingerprint,
        'X-Client-Timestamp': timestamp,
        'X-Client-Signature': signature
      },
      body: JSON.stringify(body)
    });
    return res;
  }

  async getBalance() {
    try {
      // Also ping remote to check connectivity and promo status
      this._signedPost('/credits/balance', {}).catch(() => {});
      return {
        credits: this.cachedCredits,
        fingerprint: this.deviceFingerprint.slice(0, 8) + '...'
      };
    } catch (e) {
      return { credits: this.cachedCredits, fingerprint: this.deviceFingerprint.slice(0, 8) + '...', warning: e.message };
    }
  }

  async redeemPromo(code) {
    try {
      const res = await this._signedPost('/credits/redeem', { code });
      const data = await res.json();
      if (data.success && typeof data.added === 'number') {
        this.cachedCredits += data.added;
        this.saveLocalCredits(this.cachedCredits);
        data.credits = this.cachedCredits;
      }
      return data; // { success, credits, message }
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async callChatCompletions(payload, options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    const requestType = options.requestType || 'ai_application';
    let cost = 5; // Default for full AI-tailored application
    if (requestType === 'cv_analysis') {
      cost = 5;
    } else if (requestType === 'question_qa') {
      cost = 1;
    } else if (requestType === 'cover_letter') {
      cost = 3;
    } else if (requestType === 'ai_application') {
      cost = 5;
    }

    // Local pre-flight credit check
    if (this.cachedCredits < cost) {
      throw new Error(`Insufficient AI credits: balance is ${this.cachedCredits}, required ${cost}. Top up via promo code.`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const timestamp = Date.now().toString();
    const signature = this.createSignature(timestamp);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-License': this.licenseKey,
          'X-Client-Fingerprint': this.deviceFingerprint,
          'X-Client-Timestamp': timestamp,
          'X-Client-Signature': signature,
          'X-Request-Type': requestType,
          'X-Client-Balance': this.cachedCredits.toString()
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI Gateway HTTP ${res.status}: ${text}`);
      }

      const result = await res.json();

      // Deduct locally and sync
      this.cachedCredits = Math.max(0, this.cachedCredits - cost);
      this.saveLocalCredits(this.cachedCredits);

      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = new CloudAiGateway();
