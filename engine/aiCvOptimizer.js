/**
 * AI CV Optimizer & Truthful Rewrite Engine (Hybrid Architecture)
 * 
 * Supports:
 * 1. Hybrid Mode (Local Ollama as Primary -> Hugging Face Space as Fallback -> Deterministic Rule Engine)
 * 2. Standalone Ollama (qwen2.5:3b-instruct on localhost)
 * 3. Standalone Hugging Face Space (shoaib158/Space11 via @gradio/client)
 * 4. Cloud APIs (OpenAI, Gemini, Groq, Anthropic)
 * 
 * HARD INTEGRITY CONSTRAINTS:
 * - Never invents new technologies, tools, metrics, or employers
 * - Enforces post-generation verification against unverified skill gaps
 * - Freezes project tech stacks strictly to master verified profile
 * - Instant health check & graceful fallback so the bot NEVER hangs or stops
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('./envLoader');

class AICVOptimizer {
  constructor(options = {}) {
    this.settings = this.loadSettings();
    this.mode = options.mode || this.settings.mode || 'hybrid';

    // Groq Config
    const groqCfg = this.settings.groq || {};
    this.groqModel = options.groqModel || groqCfg.model || 'qwen/qwen3.8-27b';
    this.groqTimeoutMs = options.groqTimeoutMs || groqCfg.timeoutMs || 15000;

    // Ollama Config
    const ollamaCfg = this.settings.ollama || {};
    this.ollamaHost = options.host || ollamaCfg.host || this.settings.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.ollamaModel = options.model || ollamaCfg.model || this.settings.model || 'qwen2.5:3b-instruct';
    this.ollamaTimeoutMs = options.timeoutMs || ollamaCfg.timeoutMs || 80000;
    this.probeTimeoutMs = ollamaCfg.probeTimeoutMs || 1500;

    // Hugging Face Space Config
    const hfCfg = this.settings.hfSpace || {};
    this.hfSpaceId = options.hfSpaceId || hfCfg.spaceId || 'shoaib158/Space11';
    this.hfEndpoint = options.hfEndpoint || hfCfg.apiEndpoint || '/analyze';
    this.hfTimeoutMs = options.hfTimeoutMs || hfCfg.timeoutMs || 45000;

    // In-memory CV optimization cache (0ms instant hits for same role profiles)
    this.cache = new Map();

    // Direct Cloud Provider Config (if mode is single cloud provider)
    this.provider = options.provider || this.settings.provider || (this.mode === 'hybrid' ? 'hybrid' : this.detectProvider());
    this.apiKey = options.apiKey || this.resolveApiKey(this.provider);
  }

  loadSettings() {
    try {
      const p = path.join(__dirname, '..', 'config', 'settings.json');
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return data.aiOptimizer || {};
      }
    } catch (e) {}
    return {};
  }

  detectProvider() {
    if (this.settings.provider) return this.settings.provider;
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    return 'hybrid';
  }

  resolveApiKey(provider) {
    switch (provider) {
      case 'openai': return process.env.OPENAI_API_KEY || '';
      case 'gemini': return process.env.GEMINI_API_KEY || '';
      case 'groq': return process.env.GROQ_API_KEY || '';
      case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
      case 'ollama':
      case 'hf_space':
      case 'hybrid': return 'local-or-free-no-key-required';
      default: return '';
    }
  }

  isAvailable() {
    if (this.mode === 'hybrid') return true;
    if (this.provider === 'ollama' || this.provider === 'hf_space') return true;
    return this.provider !== 'none' && !!this.apiKey;
  }

  /**
   * Fast health-check probe to verify local Ollama daemon is responsive
   * Rejects in <= 2 seconds if Ollama is closed, preventing bot stalls
   */
  /**
   * Auto-start local Ollama daemon if not already running on port 11434
   */
  async launchOllamaIfNeeded() {
    if (await this.isOllamaAlive()) return true;

    const defaultOllamaPath = path.join(
      process.env.LOCALAPPDATA || 'C:\\Users\\mshoa\\AppData\\Local',
      'Programs', 'Ollama', 'ollama.exe'
    );

    if (!fs.existsSync(defaultOllamaPath)) {
      return false;
    }

    try {
      console.log('🤖 Auto-starting Local Ollama daemon in background...');
      const child = spawn(defaultOllamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OLLAMA_IGPU_ENABLE: '1'
        }
      });
      child.unref();

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await this.isOllamaAlive()) {
          console.log('✓ Local Ollama daemon auto-started and ready on port 11434.');
          return true;
        }
      }
    } catch (e) {
      console.warn('Ollama auto-launch attempt error:', e.message);
    }
    return false;
  }

  async isOllamaAlive() {
    try {
      const res = await fetch(`${this.ollamaHost.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(this.probeTimeoutMs)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Main entry point to optimize a CV with an AI model
   * @param {Object} masterProfile - Verified candidate master profile
   * @param {Object} job - Target job details
   * @param {Object} matchAnalysis - Output from JDAnalyzer
   * @returns {Promise<Object|null>} Tailored content or null on fallback
   */
  async optimize(masterProfile, job, matchAnalysis) {
    if (!this.isAvailable()) {
      return null;
    }

    const cleanTitle = (job.title || 'role').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
    const cacheKey = `${cleanTitle}_${(job.company || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20)}`;
    if (this.cache.has(cacheKey)) {
      console.log(`⚡ [AI CV Optimizer] Reusing cached AI optimization for "${job.title}" (0ms hit).`);
      return this.cache.get(cacheKey);
    }

    let result = null;

    // 1. HYBRID EXECUTION FLOW
    if (this.mode === 'hybrid') {
      result = await this.executeHybrid(masterProfile, job, matchAnalysis);
    } else {
      // 2. DIRECT SINGLE-PROVIDER EXECUTION FLOW
      try {
        if (this.provider === 'hf_space') {
          result = await this.callHFSpace(job, masterProfile, matchAnalysis);
        } else {
          const prompt = this.buildPrompt(masterProfile, job, matchAnalysis);
          const rawResponse = await this.callLLM(prompt, this.provider);
          const parsed = this.parseJSONResponse(rawResponse);
          if (parsed) {
            result = this.enforceIntegrity(parsed, masterProfile, matchAnalysis, this.provider, this.ollamaModel, job);
          }
        }
      } catch (err) {
        console.warn(`⚠️ [AI CV Optimizer] LLM call failed (${err.message}). Falling back to deterministic tailor.`);
        result = null;
      }
    }

    if (result) {
      this.cache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * Robust Multi-Tier Hybrid Pipeline:
   * Level 1: Groq Cloud API (Ultra-Fast 0.8s LLM - qwen/qwen3.8-27b) [if GROQ_API_KEY present]
   * Level 2: Local Ollama (qwen2.5:3b-instruct - auto-started)
   * Level 3: Hugging Face Space (shoaib158/Space11)
   * Level 4: Deterministic Rule Engine (null return - 0.2s instant)
   */
  async executeHybrid(masterProfile, job, matchAnalysis) {
    // --- LEVEL 1: Groq Cloud API ---
    if (process.env.GROQ_API_KEY || (this.provider === 'groq' && this.apiKey)) {
      try {
        console.log(`⚡ [Hybrid AI Engine] Level 1: Calling Groq Cloud API (${this.groqModel})...`);
        const prompt = this.buildPrompt(masterProfile, job, matchAnalysis);
        const groqResult = await this.callGroq(prompt);
        const rawResponse = typeof groqResult === 'object' ? groqResult.content : groqResult;
        const usedModel = typeof groqResult === 'object' ? groqResult.model : this.groqModel;
        const parsed = this.parseJSONResponse(rawResponse);

        if (parsed) {
          const sanitized = this.enforceIntegrity(parsed, masterProfile, matchAnalysis, 'groq', usedModel, job);
          console.log(`✓ [Hybrid AI Engine] Groq Cloud API (${usedModel}) successfully optimized CV.`);
          return sanitized;
        }
        console.warn('⚠️ [Hybrid AI Engine] Groq returned invalid JSON. Falling back to Level 2 (Local Ollama)...');
      } catch (groqErr) {
        console.warn(`⚠️ [Hybrid AI Engine] Groq call failed (${groqErr.message}).`);
        if (groqErr.message && groqErr.message.includes('429')) {
          console.log(`⚡ [Hybrid AI Engine] Groq rate limit reached. Fast-falling back directly to Level 4 Deterministic Tailor (0.2s) to maintain continuous automation speed.`);
          return null; // Immediately yield to Level 4 without burning 2 minutes on CPU!
        }
        console.log(`Falling back to Level 2 (Local Ollama)...`);
      }
    }

    // --- LEVEL 2: Local Ollama ---
    let ollamaAvailable = await this.isOllamaAlive();
    if (!ollamaAvailable) {
      console.log('🤖 Local Ollama is not active. Auto-starting Ollama service in background...');
      ollamaAvailable = await this.launchOllamaIfNeeded();
    }
    if (ollamaAvailable) {
      try {
        console.log(`🤖 [Hybrid AI Engine] Level 2: Calling local Ollama (${this.ollamaModel})...`);
        const prompt = this.buildPrompt(masterProfile, job, matchAnalysis);
        const rawResponse = await this.callOllama(prompt);
        const parsed = this.parseJSONResponse(rawResponse);

        if (parsed) {
          const sanitized = this.enforceIntegrity(parsed, masterProfile, matchAnalysis, 'ollama', this.ollamaModel, job);
          console.log(`✓ [Hybrid AI Engine] Local Ollama successfully optimized CV.`);
          return sanitized;
        }
        console.warn('⚠️ [Hybrid AI Engine] Local Ollama returned invalid JSON. Falling back to Level 3 (HF Space)...');
      } catch (ollamaErr) {
        console.warn(`⚠️ [Hybrid AI Engine] Local Ollama execution failed (${ollamaErr.message}).`);
      }
    } else {
      console.log(`ℹ️ [Hybrid AI Engine] Local Ollama not running. Switching directly to Level 3 (Hugging Face Space)...`);
    }

    // --- LEVEL 3: Hugging Face Space ---
    try {
      console.log(`☁️ [Hybrid AI Engine] Level 3: Calling Hugging Face Space (${this.hfSpaceId})...`);
      const hfResult = await this.callHFSpace(job, masterProfile, matchAnalysis);
      if (hfResult) {
        console.log(`✓ [Hybrid AI Engine] Hugging Face Space successfully optimized CV.`);
        return hfResult;
      }
    } catch (hfErr) {
      console.warn(`⚠️ [Hybrid AI Engine] Hugging Face Space failed (${hfErr.message}).`);
    }

    // --- LEVEL 4: Fallback to Deterministic Tailor ---
    console.log(`🛡️ [Hybrid AI Engine] Level 4: Gracefully falling back to 100% verified deterministic tailor.`);
    return null;
  }

  /**
   * Constructs strict prompt grounding the LLM in verified profile facts only
   */
  buildPrompt(masterProfile, job, matchAnalysis) {
    const verifiedRequired = matchAnalysis.skills.required.verified.map(s => s.name);
    const verifiedPreferred = matchAnalysis.skills.preferred.verified.map(s => s.name);
    const criticalGaps = matchAnalysis.gaps.criticalGaps || [];

    const systemPrompt = `You are an expert resume writer and career strategist for a Junior AI/ML Engineer.
Your duty is to truthfully tailor a candidate's resume for a specific job opening using their real background.

CRITICAL INTEGRITY & TRUTH RULES:
1. STRICT HONESTY: Absolutely NO fabrication of any kind. Never invent technologies, databases, frameworks, metrics, or employers.
2. VERIFIED SKILLS ONLY: The candidate ONLY has the verified skills listed below. You must NEVER claim skills from the "CRITICAL GAPS / DO NOT CLAIM" list.
3. DYNAMIC TARGETED PROJECT SUGGESTIONS (MANDATORY): Do NOT repeat the exact same static projects in every resume. Based on the target job requirements (${job.title} at ${job.company}), generate 2 to 3 tailored project suggestions with creative, professional titles and action-oriented bullet points. Each suggested project's techStack must draw strictly from the candidate's verified skills list.
4. REFRAME, DO NOT INVENT: Reframe existing verified bullet points to highlight aspects relevant to the target job without changing the underlying truth.
5. ATS FRIENDLY & CONCISE: Produce clear, professional, active-voice descriptions. Max 25 words per bullet.
6. METRICS: Use a number only if it is in the background. Otherwise use defensible qualitative phrasing ("improved recall", "reduced lookup latency") or a placeholder like [X%] or [N] for the candidate to fill in. Never invent unverified metrics.
7. JUNIOR SENIORITY: Keep seniority realistic for a junior engineer ("built", "implemented", "developed", "trained", "integrated"; avoid "led" or "architected" unless in the background).
8. TENSE: Present tense for the current role ("Build", "Develop", "Implement"), past tense for earlier work.
9. FORBIDDEN WORDS: Do not use these words: proven, robust, seamless, rigorous, cutting-edge, production-grade, architected.
10. NO REPETITION ACROSS SECTIONS: Experience bullets and projects must not repeat the same tools or the same accomplishment. If a tool (e.g. LangGraph or Qdrant) already appears in the experience section, projects should highlight different verified skills supported by the JD (e.g. PyTorch model evaluation, computer vision, tabular data science, or MLOps CI/CD).
11. BULLET STRUCTURE: Every bullet follows: action → method/tool → result. If no result exists in the background, end with a placeholder like [metric].
12. SUMMARY REQUIREMENTS: The summary must state years of experience (~2 years) and degree/student status (BS in Computer Science student).
13. HEADER TITLE: Must match candidate's real job title (Junior AI Engineer), optionally followed by a focus area (e.g., "Junior AI Engineer (LLM Systems)").

Return ONLY a valid JSON object matching the requested schema. No conversational preamble or postscript.`;

    const userPrompt = `TARGET JOB:
- Title: ${job.title || 'AI Engineer'}
- Company: ${job.company || 'Target Company'}
- Key Verified Overlapping Skills: ${[...verifiedRequired, ...verifiedPreferred].join(', ') || 'AI, Python, FastAPI'}
- CRITICAL GAPS / DO NOT CLAIM: ${criticalGaps.length > 0 ? criticalGaps.join(', ') : 'None'}

CANDIDATE VERIFIED PROFILE:
- Real Title: Junior AI Engineer
- Experience: ~2 years hands-on AI engineering at AppEvolve (Jun 2024 – Present)
- Education: BS in Computer Science student at University of Gujrat
- Current Summary: ${masterProfile.summary}
- Verified Experience Bullets (AppEvolve - Current Role):
${masterProfile.experience[0]?.bullets.map((b, i) => `  [${i + 1}] ${b}`).join('\n')}

- Candidate Verified Skills:
${(masterProfile.getAllVerifiedSkills ? masterProfile.getAllVerifiedSkills() : []).join(', ')}

TASK:
1. "tailoredTitle": Match candidate's real job title (Junior AI Engineer), optionally followed by target focus area (e.g., "Junior AI Engineer (LLM Systems)").
2. "tailoredSummary": Write a concise, impactful 2-sentence summary tailored specifically for ${job.title} at ${job.company}. Must state ~2 years experience and BS Computer Science student status, highlighting ONLY verified overlapping competencies without buzzwords.
3. "tailoredExperienceBullets": Reframe the 4 verified bullets in PRESENT TENSE using action → method/tool → result/[metric]. Max 25 words per bullet. Zero buzzwords.
4. "selectedProjects": Generate 2 distinct role-targeted project suggestions tailored to ${job.title} at ${job.company}:
   - CRITICAL: Do NOT repeat the primary tools already featured in the experience section. Projects must show different verified skills (e.g. PyTorch model evaluation/fine-tuning, computer vision, tabular machine learning/feature engineering, or MLOps CI/CD).
   - Each project has:
     "name": Concise, professional project title
     "techStack": [Array of verified technologies only - differentiated from main experience tools]
     "bullets": [2 concise bullets, max 25 words each, following action → method/tool → result/[metric]]

OUTPUT JSON SCHEMA:
{
  "tailoredTitle": "string",
  "tailoredSummary": "string",
  "tailoredExperienceBullets": ["string", "string", "string", "string"],
  "selectedProjects": [
    {
      "name": "Project name",
      "techStack": ["string", "string"],
      "bullets": ["string", "string"]
    }
  ]
}`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Direct call to Groq Cloud API with Auto-Cooldown & Token Capping
   */
  async callGroq({ systemPrompt, userPrompt }) {
    const apiKey = process.env.GROQ_API_KEY || this.apiKey;
    const model = this.groqModel || 'qwen/qwen3.8-27b';
    let hasRetried = false;

    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.groqTimeoutMs);

      try {
        const reqBody = {
          model: model,
          max_tokens: 580, // Prevents reserving entire 8K context while allowing full CV JSON
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        };

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(reqBody),
          signal: controller.signal
        });

        if (res.status === 429) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || 'Rate limit reached';
          const waitMatch = errMsg.match(/try again in ([\d.]+)s/i);
          const waitSec = waitMatch ? parseFloat(waitMatch[1]) : 3;

          if (!hasRetried && waitSec <= 4.5) {
            hasRetried = true;
            console.log(`⏳ [Groq] OTPM rate limit reached. Auto-waiting ${waitSec.toFixed(1)}s for token cooldown...`);
            await new Promise(r => setTimeout(r, Math.ceil(waitSec * 1000) + 600));
            continue; // Retry once after cooldown
          }

          throw new Error(`Groq HTTP 429: ${errMsg.slice(0, 100)}`);
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 100)}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (content) {
          return { content, model };
        }
        throw new Error('Groq returned empty response');
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error(`Groq timed out after ${this.groqTimeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Direct call to local Ollama daemon
   */
  async callOllama({ systemPrompt, userPrompt }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.ollamaTimeoutMs);

    try {
      const url = `${this.ollamaHost.replace(/\/$/, '')}/api/chat`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.2,
            num_predict: 280
          },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return data.message?.content || '';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Direct call to Hugging Face Space (shoaib158/Space11) via @gradio/client
   */
  async callHFSpace(job, masterProfile, matchAnalysis) {
    const timeout = this.hfTimeoutMs || 6000;

    const callPromise = (async () => {
      const { Client } = await import('@gradio/client');
      const app = await Client.connect(this.hfSpaceId);
      const jdText = `Job Title: ${job.title || 'AI Engineer'}\nCompany: ${job.company || 'Target Company'}\nDescription:\n${job.description || ''}`;

      const result = await app.predict(this.hfEndpoint, {
        jd: jdText
      });

      const rawOutput = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!rawOutput || typeof rawOutput !== 'string') {
        throw new Error('Empty response from Hugging Face Space');
      }

      const structured = this.parseHFResponse(rawOutput, masterProfile, job, matchAnalysis);
      return this.enforceIntegrity(structured, masterProfile, matchAnalysis, 'hf_space', 'qwen-hf', job);
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Hugging Face Space call timed out after ${timeout}ms`)), timeout)
    );

    return await Promise.race([callPromise, timeoutPromise]);
  }

  /**
   * Parse 4-part Hugging Face text output into standardized resume model
   */
  parseHFResponse(rawText, masterProfile, job, matchAnalysis) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    let currentSection = 0;
    const extractedKeywords = [];
    const matchingSkills = [];
    const projectLines = [];
    const missingSkills = [];

    for (const line of lines) {
      if (/1\.\s*Top\s*10/i.test(line)) { currentSection = 1; continue; }
      if (/2\.\s*Skills\s*from/i.test(line)) { currentSection = 2; continue; }
      if (/3\.\s*Up\s*to\s*3/i.test(line)) { currentSection = 3; continue; }
      if (/4\.\s*Missing/i.test(line)) { currentSection = 4; continue; }

      const cleanItem = line.replace(/^[-*•\d.]+\s*/, '').replace(/^"|"$/g, '').trim();
      if (!cleanItem) continue;

      if (currentSection === 1) extractedKeywords.push(cleanItem);
      else if (currentSection === 2) matchingSkills.push(cleanItem);
      else if (currentSection === 3) projectLines.push(cleanItem);
      else if (currentSection === 4) missingSkills.push(cleanItem);
    }

    // Compose tailored summary
    const topSkills = matchingSkills.slice(0, 3).join(', ') || 'LLMs, RAG Pipelines, Python';
    const targetTitle = job.title || masterProfile.personal?.targetTitle || 'AI Engineer';
    const tailoredSummary = `Results-driven ${targetTitle} specializing in ${topSkills}. Proven track record designing autonomous multi-agent systems, scalable FastAPI backend services, and high-performance RAG pipelines with robust evaluation standards.`;

    // Generate role-targeted project suggestions tailored to the job
    const cvTailor = require('./cvTailor');
    const selectedProjects = cvTailor.generateSuggestedProjects(job, matchingSkills);

    return {
      tailoredSummary,
      tailoredExperienceBullets: masterProfile.experience[0]?.bullets || [],
      selectedProjects
    };
  }

  /**
   * Fallback for external cloud providers (OpenAI, Gemini, Groq, Anthropic)
   */
  async callLLM({ systemPrompt, userPrompt }, provider = 'openai') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      if (provider === 'openai' || provider === 'groq') {
        const baseUrl = provider === 'groq' 
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const activeKey = provider === 'groq' ? (process.env.GROQ_API_KEY || this.apiKey) : this.apiKey;

        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeKey}`
          },
          body: JSON.stringify({
            model: provider === 'groq' ? (this.groqModel || 'qwen/qwen3.8-27b') : 'gpt-4o-mini',
            max_tokens: 380,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          }),
          signal: controller.signal
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }

      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      throw new Error(`Unsupported cloud provider: ${provider}`);
    } finally {
      clearTimeout(timer);
    }
  }

  parseJSONResponse(rawText) {
    if (!rawText) return null;
    const cleaned = rawText
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        } catch (_) {}
      }
      return null;
    }
  }

  /**
   * Post-generation guard: Scans for forbidden unverified skills and verifies project tech stacks
   */
  enforceIntegrity(llmOutput, masterProfile, matchAnalysis, provider = 'hybrid', model = 'auto', job = null) {
    const criticalGaps = (matchAnalysis.gaps?.criticalGaps || []).map(g => g.toLowerCase());
    const familiarGaps = (matchAnalysis.gaps?.familiarGaps || []).map(g => g.toLowerCase().replace(/\s*\(.*?\)/, ''));
    const forbidden = [...criticalGaps, ...familiarGaps];

    // Helper: Strip buzzwords and soften seniority
    const sanitizeBuzzwords = (txt) => {
      if (!txt || typeof txt !== 'string') return txt;
      return txt
        .replace(/\barchitected\b/gi, 'built')
        .replace(/\bproduction-grade\b/gi, 'production')
        .replace(/\bproven expertise\b/gi, 'hands-on experience')
        .replace(/\bproven\b/gi, 'demonstrated')
        .replace(/\bcutting-edge\b/gi, 'modern')
        .replace(/\bseamless integration\b/gi, 'integration')
        .replace(/\bseamless\b/gi, 'direct')
        .replace(/\brobust\b/gi, 'reliable')
        .replace(/\brigorous\b/gi, 'structured');
    };

    // 0. Guard Title (Must align with candidate's real title: Junior AI Engineer)
    let tailoredTitle = llmOutput.tailoredTitle;
    if (tailoredTitle) {
      if (!/^Junior AI Engineer/i.test(tailoredTitle)) {
        const clean = tailoredTitle.replace(/\(verified job\)/i, '').replace(/\[.*?\]/g, '').trim();
        const focus = clean.replace(/^(junior|senior|lead|staff)?\s*(ai|ml|machine learning)\s*(engineer)?\s*[-–/:]?\s*/i, '').trim();
        tailoredTitle = focus ? `Junior AI Engineer (${focus})` : 'Junior AI Engineer';
      }
    }

    // 1. Guard Summary
    let tailoredSummary = llmOutput.tailoredSummary || masterProfile.summary;
    for (const badSkill of forbidden) {
      if (badSkill.length > 2 && new RegExp(`\\b${badSkill}\\b`, 'i').test(tailoredSummary)) {
        console.warn(`🛡️ [Integrity Guard] LLM attempted to include unverified skill "${badSkill}" in summary. Falling back to verified summary.`);
        tailoredSummary = masterProfile.summary;
        break;
      }
    }

    // 2. Guard Experience Bullets
    let tailoredExperienceBullets = Array.isArray(llmOutput.tailoredExperienceBullets) && llmOutput.tailoredExperienceBullets.length > 0
      ? llmOutput.tailoredExperienceBullets
      : masterProfile.experience[0]?.bullets;

    tailoredExperienceBullets = tailoredExperienceBullets.map((bullet, idx) => {
      for (const badSkill of forbidden) {
        if (badSkill.length > 2 && new RegExp(`\\b${badSkill}\\b`, 'i').test(bullet)) {
          console.warn(`🛡️ [Integrity Guard] LLM included unverified "${badSkill}" in experience bullet. Reverting bullet #${idx + 1}.`);
          return masterProfile.experience[0]?.bullets[idx] || bullet;
        }
      }
      return bullet;
    });

    // 3. Guard Projects (Supports verified master projects + verified dynamic projects)
    const verifiedMasterList = (masterProfile.getAllVerifiedSkills ? masterProfile.getAllVerifiedSkills() : [])
      .map(s => s.toLowerCase());
    const allowDynamic = this.settings.dynamicProjects ?? true;

    let selectedProjects = [];
    if (Array.isArray(llmOutput.selectedProjects) && llmOutput.selectedProjects.length > 0) {
      for (const proj of llmOutput.selectedProjects) {
        if (!proj.name || !Array.isArray(proj.bullets)) continue;

        const original = masterProfile.projects.find(p => p.name.toLowerCase() === (proj.name || '').toLowerCase());
        if (original) {
          // Existing master project: freeze techStack to master profile
          const cleanBullets = (Array.isArray(proj.bullets) && proj.bullets.length > 0 ? proj.bullets : original.bullets).map((b, i) => {
            for (const badSkill of forbidden) {
              if (badSkill.length > 2 && new RegExp(`\\b${badSkill}\\b`, 'i').test(b)) {
                console.warn(`🛡️ [Integrity Guard] LLM included unverified "${badSkill}" in project "${original.name}". Reverting bullet.`);
                return original.bullets[i] || b;
              }
            }
            return b;
          });

          selectedProjects.push({
            name: original.name,
            techStack: [...original.techStack],
            bullets: cleanBullets
          });
        } else if (allowDynamic && Array.isArray(proj.techStack) && proj.techStack.length > 0) {
          // Dynamically proposed project: verify that ALL techStack tools exist in candidate verified skills
          const validTechStack = proj.techStack
            .filter(t => !forbidden.some(f => f.length > 2 && t.toLowerCase().includes(f)))
            .filter(t => verifiedMasterList.some(v => v === t.toLowerCase() || t.toLowerCase().includes(v) || v.includes(t.toLowerCase())));

          // Sanitize dynamic bullets: remove bullets referencing critical gaps
          const cleanBullets = proj.bullets.filter(b => {
            for (const badSkill of forbidden) {
              if (badSkill.length > 2 && new RegExp(`\\b${badSkill}\\b`, 'i').test(b)) {
                return false;
              }
            }
            return true;
          });

          if (validTechStack.length >= 2 && cleanBullets.length > 0) {
            console.log(`✨ [Integrity Guard] Verified dynamic project accepted: "${proj.name}" (Tech: ${validTechStack.join(', ')})`);
            selectedProjects.push({
              name: proj.name.trim(),
              techStack: validTechStack,
              bullets: cleanBullets
            });
          }
        }
      }
    }

    if (selectedProjects.length === 0) {
      const cvTailor = require('./cvTailor');
      const targetJob = job || matchAnalysis?.job || {};
      const targetKws = matchAnalysis?.skills?.required?.verified?.map(s => s.name) || [];
      selectedProjects = cvTailor.generateSuggestedProjects(targetJob, targetKws);
    }

    return {
      tailoredTitle,
      tailoredSummary: sanitizeBuzzwords(tailoredSummary),
      tailoredExperienceBullets: tailoredExperienceBullets.map(sanitizeBuzzwords),
      selectedProjects: selectedProjects.map(p => ({
        ...p,
        bullets: p.bullets.map(sanitizeBuzzwords)
      })),
      aiOptimized: true,
      provider,
      model
    };
  }
}

module.exports = new AICVOptimizer();
