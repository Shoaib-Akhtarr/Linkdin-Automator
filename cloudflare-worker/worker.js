/**
 * AutoApply AI Gateway — Cloudflare Worker v3.0
 * ─────────────────────────────────────────────
 * Routes:
 *   POST /               → AI proxy (Groq) + credit burn
 *   POST /credits/balance → { credits: N }
 *   POST /credits/redeem  → { success, credits, message }
 *
 * Credit costs:
 *   X-Request-Type: cv_analysis    → 5 credits (Deep ATS parsing, job titles, skill gap analysis)
 *   X-Request-Type: ai_application → 5 credits (JD tailor, ATS resume PDF generation, screening Q&A)
 *   X-Request-Type: question_qa    → 1 credit  (Single complex screening question answer)
 *   anything else                  → 1 credit  (Default lightweight prompt)
 *
 * New devices auto-get 25 FREE credits on first contact (1 CV Analysis + 4 Full AI Applications).
 */

// ── Secrets (Configured in Cloudflare Worker Environment Variables) ─────────
const GROQ_API_KEY = typeof env !== 'undefined' && env.GROQ_API_KEY ? env.GROQ_API_KEY : "YOUR_GROQ_API_KEY";
const APP_LICENSE_KEY = "AutoApply-VIP-Pass-2026";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ── Promo Code Dictionary ─────────────────────────────────────────────────────
// { CODE: credits_to_add }
const PROMO_CODES = {
  "LAUNCH25":      50,    // 10 Full AI Applications
  "LAUNCH50":      50,    // 10 Full AI Applications
  "BETA-TESTER":   100,   // 20 Full AI Applications
  "FRIEND-VIP":    250,   // 50 Full AI Applications
  "PRO-UNLIMITED": 1000,  // 200 Full AI Applications
  "SHOAIB-DEV":    99999  // Owner override for testing
};

// Free credits given to any new device fingerprint
const FREE_STARTER_CREDITS = 25;

// ── In-memory Credit Ledger (with optional Cloudflare KV persistence) ──────────
// Map<fingerprint, { credits: number, redeemedCodes: Set<string> }>
const creditLedger = new Map();

// ── Rate limit tracker (keep existing abuse protection) ───────────────────────
const clientRequestCounts = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getClientRecord(fingerprint, env) {
  // If Cloudflare KV is bound (e.g. env.CREDITS_KV or env.KV)
  const kv = env?.CREDITS_KV || env?.KV;
  if (kv) {
    try {
      const stored = await kv.get(fingerprint);
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.redeemedCodes = new Set(parsed.redeemedCodes || []);
        creditLedger.set(fingerprint, parsed);
        return parsed;
      }
    } catch (_) {}
  }

  if (!creditLedger.has(fingerprint)) {
    creditLedger.set(fingerprint, {
      credits: FREE_STARTER_CREDITS,
      redeemedCodes: new Set()
    });
  }
  return creditLedger.get(fingerprint);
}

async function saveClientRecord(fingerprint, record, env) {
  creditLedger.set(fingerprint, record);
  const kv = env?.CREDITS_KV || env?.KV;
  if (kv) {
    try {
      await kv.put(fingerprint, JSON.stringify({
        credits: record.credits,
        redeemedCodes: Array.from(record.redeemedCodes || [])
      }));
    } catch (_) {}
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  });
}

async function validateRequest(request) {
  const license = request.headers.get('X-App-License');
  const fingerprint = request.headers.get('X-Client-Fingerprint');
  const timestamp = request.headers.get('X-Client-Timestamp');
  const signature = request.headers.get('X-Client-Signature');

  if (license !== APP_LICENSE_KEY) {
    return { valid: false, error: 'Invalid license key', status: 401 };
  }
  if (!fingerprint || !timestamp || !signature) {
    return { valid: false, error: 'Missing security headers', status: 400 };
  }

  // Replay attack: reject requests older than 5 minutes
  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) {
    return { valid: false, error: 'Request timestamp expired', status: 401 };
  }

  // HMAC-SHA256 signature verification
  const encoder = new TextEncoder();
  const keyData = encoder.encode(APP_LICENSE_KEY);
  const msgData = encoder.encode(`${fingerprint}:${timestamp}`);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = hexToUint8Array(signature);
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, msgData);
  if (!valid) {
    return { valid: false, error: 'Invalid request signature', status: 401 };
  }

  return { valid: true, fingerprint };
}

function hexToUint8Array(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

// ── Main Handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Public health check (supports GET and POST)
    if (path === '/health') {
      return json({ status: 'ok', version: '3.1' });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // ── Validate all requests ─────────────────────────────────────────────
    const validation = await validateRequest(request);
    if (!validation.valid) {
      return json({ error: validation.error }, validation.status);
    }

    const { fingerprint } = validation;
    const record = await getClientRecord(fingerprint, env);

    // ── Route: /credits/balance ───────────────────────────────────────────
    if (path === '/credits/balance') {
      return json({ credits: record.credits, fingerprint: fingerprint.slice(0, 8) + '...' });
    }

    // ── Route: /credits/redeem ────────────────────────────────────────────
    if (path === '/credits/redeem') {
      let body;
      try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

      const code = (body.code || '').trim().toUpperCase();
      if (!code) return json({ success: false, message: 'No promo code provided' }, 400);

      if (!PROMO_CODES.hasOwnProperty(code)) {
        return json({ success: false, message: 'Invalid promo code' });
      }
      if (record.redeemedCodes.has(code)) {
        return json({ success: false, message: 'Code already used on this device' });
      }

      const added = PROMO_CODES[code];
      record.credits += added;
      record.redeemedCodes.add(code);
      await saveClientRecord(fingerprint, record, env);

      return json({
        success: true,
        credits: record.credits,
        added,
        message: `✅ ${added} credits added! Balance: ${record.credits}`
      });
    }

    // ── Route: / (AI Proxy with credit burn) ─────────────────────────────
    if (path === '/') {
      // Determine credit cost based on professional market value
      const requestType = request.headers.get('X-Request-Type') || 'ai_application';
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

      // Sync with client balance header if supplied
      const clientBalanceHeader = request.headers.get('X-Client-Balance');
      if (clientBalanceHeader !== null) {
        const parsedBalance = parseInt(clientBalanceHeader, 10);
        if (!isNaN(parsedBalance) && parsedBalance >= 0) {
          record.credits = Math.min(record.credits, parsedBalance);
        }
      }

      // Check credit balance
      if (record.credits < cost) {
        return json({
          error: 'insufficient_credits',
          credits: record.credits,
          required: cost,
          message: `Not enough credits (have ${record.credits}, need ${cost}). Top up via promo code.`
        }, 402);
      }

      // Rate limit check (abuse protection layer)
      const now = Date.now();
      const windowMs = 60 * 1000;
      let counts = clientRequestCounts.get(fingerprint) || { count: 0, windowStart: now };
      if (now - counts.windowStart > windowMs) {
        counts = { count: 0, windowStart: now };
      }
      counts.count++;
      clientRequestCounts.set(fingerprint, counts);
      if (counts.count > 20) {
        return json({ error: 'Rate limit exceeded. Max 20 AI requests per minute.' }, 429);
      }

      // Parse body
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

      // Safe guard max_tokens to prevent Groq 429 OTPM limit errors
      if (body && typeof body === 'object') {
        if (!body.max_tokens || body.max_tokens > 800) {
          body.max_tokens = 500;
        }
      }

      // Proxy to Groq
      const groqRes = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text().catch(() => '');
        return json({ error: `Groq API error ${groqRes.status}: ${errText}` }, groqRes.status);
      }

      // Burn credits ONLY after successful Groq response
      record.credits -= cost;
      await saveClientRecord(fingerprint, record, env);

      const groqData = await groqRes.json();

      // Inject remaining credits into response for client awareness
      groqData._credits_remaining = record.credits;

      return json(groqData);
    }

    // Health check
    if (path === '/health') {
      return json({ status: 'ok', version: '3.0' });
    }

    return json({ error: 'Not found' }, 404);
  }
};
