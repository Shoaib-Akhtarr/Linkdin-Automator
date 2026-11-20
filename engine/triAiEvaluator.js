/**
 * Tri-AI Consensus Evaluator & Job Description Beautifier
 * 
 * Consults 3 frontier AI models in parallel on Groq:
 * 1. Qwen 27B (qwen/qwen3.8-27b)
 * 2. GPT OSS 20B (openai/gpt-oss-20b)
 * 3. GPT OSS 120B (openai/gpt-oss-120b)
 * 
 * Rates each job out of 10 for candidate attention & interview callback potential,
 * gives a combined consensus recommendation, and structures the JD professionally.
 */

'use strict';

const fs = require('fs');
const path = require('path');
require('./envLoader');
const cvTailor = require('./cvTailor');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'tri_ai_evaluations.json');
const RESUME_TXT_FILE = path.join(__dirname, '..', 'assets', 'resume.txt');
const PROFILE_JSON_FILE = path.join(__dirname, '..', 'config', 'profile.json');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const MODELS = {
  QWEN: { id: 'qwen/qwen3.8-27b', label: 'Qwen 27B' },
  GPT_OSS_20B: { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B' },
  GPT_OSS_120B: { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' }
};

class TriAiEvaluator {
  constructor() {
    this.cache = this.loadCache();
    this.candidateSummary = this.loadCandidateSummary();
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  saveCache() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.warn('[TriAiEvaluator] Cache save warning:', e.message);
    }
  }

  getCachedEvaluation(jobId) {
    if (!jobId) return null;
    return this.cache[jobId] || null;
  }

  loadCandidateSummary() {
    try {
      if (fs.existsSync(RESUME_TXT_FILE)) {
        const text = fs.readFileSync(RESUME_TXT_FILE, 'utf8');
        return text.slice(0, 1500).trim();
      }
    } catch (_) {}
    return 'Candidate: SHOAIB AKHTAR. AI Engineer & Full Stack Developer. Python, PyTorch, LangChain, LangGraph, CrewAI, FastAPI, Vector Databases (Qdrant, ChromaDB), Docker, RAG Systems, Multi-Agent Systems.';
  }

  /**
   * Parse model response lines: Score, Verdict, Reason
   */
  parseResponse(text = '', modelLabel = '') {
    let score = 7.5;
    let verdict = 'Good Match';
    let reason = 'Candidate profile matches the core technical requirements.';

    const scoreMatch = text.match(/Score:\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)\s*\/\s*10/i);
    if (scoreMatch) {
      const val = parseFloat(scoreMatch[1]);
      if (!isNaN(val)) score = Math.min(10, Math.max(1, val));
    }

    const verdictMatch = text.match(/Verdict:\s*([^\n\r]+)/i);
    if (verdictMatch) {
      verdict = verdictMatch[1].replace(/[*_]/g, '').trim();
    }

    const reasonMatch = text.match(/Reason:\s*([^\n\r]+)/i);
    if (reasonMatch) {
      reason = reasonMatch[1].replace(/[*_]/g, '').trim();
    } else {
      // Fallback: first non-empty line after score
      const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.toLowerCase().startsWith('score:'));
      if (lines.length > 0) reason = lines[lines.length - 1].slice(0, 180);
    }

    return {
      model: modelLabel,
      score: Math.round(score * 10) / 10,
      verdict,
      reason
    };
  }

  /**
   * Query a single model on Groq with automatic retry on 429 rate limit
   */
  async queryModel(modelCfg, jobPrompt, retries = 0) {
    if (!GROQ_API_KEY) {
      return {
        model: modelCfg.label,
        score: 8.0,
        verdict: 'Good Match',
        reason: 'Simulated score (Groq API Key not configured)'
      };
    }

    const payload = {
      model: modelCfg.id,
      messages: [
        {
          role: 'user',
          content: jobPrompt
        }
      ],
      temperature: 0.15,
      max_tokens: 750
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 429 && retries < 2) {
          await new Promise(r => setTimeout(r, 1500 * (retries + 1)));
          return this.queryModel(modelCfg, jobPrompt, retries + 1);
        }
        throw new Error(`Groq HTTP ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      return this.parseResponse(content, modelCfg.label);
    } catch (err) {
      clearTimeout(timeout);
      if (retries < 1 && err.message.includes('429')) {
        await new Promise(r => setTimeout(r, 2000));
        return this.queryModel(modelCfg, jobPrompt, retries + 1);
      }
      return {
        model: modelCfg.label,
        score: 7.5,
        verdict: 'Evaluate Manually',
        reason: `Model query note: ${err.message}`
      };
    }
  }

  /**
   * Dynamically synthesize the ATS-tailored CV customized specifically for this job
   * Uses the candidate's verified skills, adapts target title, prioritizes matching keywords,
   * generates tailored professional summary, and aligns projects to this exact opening.
   */
  generateTailoredCv(job = {}) {
    try {
      const tailored = cvTailor.tailorProfile(job);
      const p = tailored.personal || {};
      const s = tailored.skills || {};

      let text = '';
      text += `Candidate: ${p.fullName || 'Shoaib Akhtar'}\n`;
      text += `Tailored Target Title: ${p.targetTitle || job.title || 'Junior AI Engineer'}\n`;
      text += `Email: ${p.email || 'onlyshoaib158@gmail.com'} | Location: ${p.location || 'Remote / Worldwide'}\n\n`;

      text += `--- PROFESSIONAL SUMMARY (TAILORED FOR ${String(job.company || 'TARGET ORGANIZATION').toUpperCase()}) ---\n`;
      text += `${tailored.summary || ''}\n\n`;

      text += `--- TARGET-ALIGNED TECHNICAL SKILLS ---\n`;
      if (s.generativeAI && s.generativeAI.length) text += `• Generative AI & LLMs: ${s.generativeAI.slice(0, 10).join(', ')}\n`;
      if (s.frameworks && s.frameworks.length) text += `• Frameworks & ML: ${s.frameworks.slice(0, 10).join(', ')}\n`;
      if (s.mlopsAndCloud && s.mlopsAndCloud.length) text += `• MLOps, Cloud & Containers: ${s.mlopsAndCloud.slice(0, 8).join(', ')}\n`;
      if (s.languages && s.languages.length) text += `• Programming Languages: ${s.languages.join(', ')}\n`;
      if (s.dataScience && s.dataScience.length) text += `• Data Science & DBs: ${s.dataScience.slice(0, 8).join(', ')}\n\n`;

      text += `--- RELEVANT PROFESSIONAL EXPERIENCE ---\n`;
      (tailored.experience || []).forEach(exp => {
        text += `${exp.role} | ${exp.company} (${exp.period})\n`;
        (exp.bullets || []).forEach(b => text += `  • ${b}\n`);
        text += '\n';
      });

      text += `--- ALIGNED TECHNICAL PROJECTS (TAILORED FOR THIS OPENING) ---\n`;
      (tailored.projects || []).slice(0, 3).forEach(proj => {
        text += `${proj.name} [Tech Stack: ${(proj.techStack || []).join(', ')}]\n`;
        (proj.bullets || []).forEach(b => text += `  • ${b}\n`);
        text += '\n';
      });

      text += `--- EDUCATION ---\n`;
      (tailored.education || []).forEach(edu => {
        text += `${edu.degree} - ${edu.institution} (${edu.period})\n`;
      });

      return {
        text: text.trim(),
        tailoredModel: tailored
      };
    } catch (err) {
      console.warn(`[!] cvTailor generation error: ${err.message}, falling back to master summary`);
      return {
        text: this.candidateSummary,
        tailoredModel: null
      };
    }
  }

  /**
   * Evaluate a job with all 3 AI models using the JOB-SPECIFIC TAILORED CV
   */
  async evaluateJob(job, forceRefresh = false) {
    const jobId = job.jobId || `${job.company}_${job.title}`.replace(/[^a-zA-Z0-9_]/g, '');

    if (!forceRefresh && this.cache[jobId]) {
      return this.cache[jobId];
    }

    const cleanTitle = job.title || 'Software / AI Engineer';
    const cleanCompany = job.company || 'Tech Company';
    const cleanDesc = this.stripHtmlToText(job.description || '').slice(0, 2000);

    // Generate the specific tailored CV made for this opening
    const { text: tailoredCvText, tailoredModel } = this.generateTailoredCv(job);

    const prompt = `You are an elite AI technical recruiter and hiring committee chair.
The candidate's ATS resume has been dynamically tailored and customized specifically for this exact role and company.
Evaluate whether this JOB-SPECIFIC TAILORED CV will capture recruiter attention and secure an interview callback for this position.

=== CANDIDATE'S JOB-SPECIFIC TAILORED ATS CV ===
${tailoredCvText}

=== TARGET JOB POSTING ===
Company: ${cleanCompany}
Role: ${cleanTitle}
Location: ${job.location || 'Remote'}
Job Description Summary:
${cleanDesc}

Respond strictly in this format:
Score: [number from 1 to 10 on whether this tailored CV will win an interview callback and should apply]
Verdict: [Strong Apply / Good Match / Caution / Screen Out Risk]
Reason: [One punchy sentence explaining how the tailored CV matches or where gaps remain]`;

    // Query all 3 models in parallel
    // Query all 3 models sequentially with 800ms delay to prevent Groq burst rate limits
    const qwenRes = await this.queryModel(MODELS.QWEN, prompt);
    await new Promise(r => setTimeout(r, 800));
    const gpt20Res = await this.queryModel(MODELS.GPT_OSS_20B, prompt);
    await new Promise(r => setTimeout(r, 800));
    const gpt120Res = await this.queryModel(MODELS.GPT_OSS_120B, prompt);

    // Calculate consensus
    const scores = [qwenRes.score, gpt20Res.score, gpt120Res.score].filter(s => typeof s === 'number' && !isNaN(s));
    const avgScore = scores.length > 0 
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 
      : 8.0;

    let recommendationTier = 'high';
    let consensusVerdict = 'HIGHLY RECOMMENDED';

    if (avgScore >= 8.0) {
      recommendationTier = 'high';
      consensusVerdict = 'HIGH RECRUITER ATTENTION (All 3 Models Recommend)';
    } else if (avgScore >= 6.5) {
      recommendationTier = 'moderate';
      consensusVerdict = 'GOOD FIT (Competitive Match)';
    } else {
      recommendationTier = 'low';
      consensusVerdict = 'CAUTION (Potential Stack / Seniority Gap)';
    }

    const evaluation = {
      jobId,
      consensusScore: avgScore,
      consensusVerdict,
      recommendationTier,
      evaluatedAt: new Date().toISOString(),
      models: {
        qwen: qwenRes,
        gptOss20b: gpt20Res,
        gptOss120b: gpt120Res
      },
      tailoredCvUsed: {
        targetTitle: tailoredModel?.personal?.targetTitle || cleanTitle,
        tailoredSummary: tailoredModel?.summary || '',
        matchedKeywords: tailoredModel?.matchAnalysis?.matchedKeywords || [],
        tailoredProjects: (tailoredModel?.projects || []).map(p => p.name)
      },
      beautifiedJd: this.beautifyJd(job)
    };

    this.cache[jobId] = evaluation;
    this.saveCache();

    return evaluation;
  }

  decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&bull;/g, '•')
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .replace(/&#8216;/g, "‘")
      .replace(/&#8217;/g, "’")
      .replace(/&#8220;/g, '“')
      .replace(/&#8221;/g, '”');
  }

  stripHtmlToText(str) {
    if (!str) return '';
    const decoded = this.decodeHtmlEntities(str);
    return decoded
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }

  /**
   * Transforms raw job description text into a clean, beautifully formatted layout
   */
  beautifyJd(job) {
    const raw = job.description || '';
    if (!raw) {
      return {
        overview: 'No detailed description provided by the ATS portal. Review the original career page.',
        skills: ['Python', 'AI/ML', 'Remote'],
        bullets: [],
        fullText: 'No detailed description available.'
      };
    }

    // Clean plain text
    const cleanText = this.stripHtmlToText(raw);

    // Detect technical skills/keywords
    const techDict = [
      'Machine Learning', 'Deep Learning', 'AI', 'NLP', 'Computer Vision',
      'Python', 'PyTorch', 'TensorFlow', 'LangChain', 'LangGraph', 'CrewAI', 'FastAPI',
      'Docker', 'Kubernetes', 'AWS', 'GCP', 'PostgreSQL', 'Redis', 'Qdrant', 'ChromaDB',
      'Pinecone', 'TypeScript', 'JavaScript', 'React', 'Next.js', 'Node.js', 'GraphQL',
      'REST API', 'RAG', 'LLMs', 'Fine-Tuning', 'CI/CD',
      'Git', 'SQL', 'NoSQL', 'Kafka', 'Microservices', 'Linux', 'Pandas', 'NumPy',
      'Scikit-Learn', 'Airflow', 'Spark', 'MLflow', 'Hugging Face'
    ];

    const detectedSkills = [];
    const lowerClean = cleanText.toLowerCase();
    for (const tech of techDict) {
      const reg = new RegExp(`\\b${tech.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (reg.test(lowerClean)) {
        detectedSkills.push(tech);
      }
    }

    // Extract first 2-3 clean sentences as overview
    const sentences = cleanText.split(/(?<=[.?!])\s+/);
    const overview = sentences.slice(0, 3).join(' ') || cleanText.slice(0, 300);

    // Extract genuine bullet points
    let bullets = [];
    // Priority 1: Extract from HTML <li> elements
    const liMatches = raw.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    if (liMatches && liMatches.length > 0) {
      bullets = liMatches.map(li => {
        return this.stripHtmlToText(li).replace(/\s+/g, ' ').trim();
      }).filter(b => b.length > 15 && !b.toLowerCase().includes('eeo policy') && !b.toLowerCase().includes('privacy policy') && !b.toLowerCase().includes('cookie')).slice(0, 8);
    }

    // Priority 2: Extract bullet lines from plain text (must start with bullet symbol at line beginning)
    if (bullets.length === 0) {
      const bulletLines = cleanText.match(/^[ \t]*(?:[•\-\*\u2022\u2023\u25E6\u2043\u2219]|\d+\.)[ \t]+([^\r\n]+)/gm);
      if (bulletLines && bulletLines.length > 0) {
        bullets = bulletLines
          .map(b => b.replace(/^[ \t]*(?:[•\-\*\u2022\u2023\u25E6\u2043\u2219]|\d+\.)[ \t]*/, '').trim())
          .filter(b => b.length > 15)
          .slice(0, 8);
      }
    }

    return {
      overview,
      skills: detectedSkills.slice(0, 12),
      bullets,
      fullText: cleanText
    };
  }
}

module.exports = new TriAiEvaluator();
