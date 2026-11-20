const fs = require('fs');
const path = require('path');
require('./envLoader');

class ResumeParser {
  constructor() {
    this.assetsDir = path.join(__dirname, '..', 'assets');
    this.resumePdfPath = path.join(this.assetsDir, 'resume.pdf');
    this.resumeTxtPath = path.join(this.assetsDir, 'resume.txt');
  }

  /**
   * Robust PDF text extractor supporting both pdf-parse v1 and v2
   */
  async extractTextFromPdfBuffer(buffer) {
    if (!buffer || buffer.length === 0) return '';

    try {
      const pdfModule = require('pdf-parse');
      // If pdf-parse v1 (callable function)
      if (typeof pdfModule === 'function') {
        const data = await pdfModule(buffer);
        if (data && data.text) return data.text;
      }
      // If pdf-parse v2 (PDFParse class)
      if (pdfModule && pdfModule.PDFParse) {
        const parser = new pdfModule.PDFParse({ data: buffer });
        await parser.load();
        const res = await parser.getText();
        if (typeof res === 'string') return res;
        if (res && typeof res.text === 'string') return res.text;
      }
    } catch (err) {
      console.warn('[ResumeParser] PDF extraction error:', err.message);
    }

    // Secondary fallback: check if resume.txt already exists
    try {
      if (fs.existsSync(this.resumeTxtPath)) {
        return fs.readFileSync(this.resumeTxtPath, 'utf8');
      }
    } catch (_) {}

    return '';
  }

  /**
   * Save uploaded Base64 or binary buffer to assets/resume.pdf and parse text
   */
  async saveAndParseResume(bufferOrBase64) {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }

    let buffer;
    if (typeof bufferOrBase64 === 'string') {
      // Remove data:application/pdf;base64, prefix if present
      const cleanBase64 = bufferOrBase64.replace(/^data:application\/pdf;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
    } else {
      buffer = bufferOrBase64;
    }

    // Write file
    fs.writeFileSync(this.resumePdfPath, buffer);

    // Parse PDF text
    let parsedText = '';
    try {
      parsedText = await this.extractTextFromPdfBuffer(buffer);
      if (parsedText && parsedText.trim().length > 0) {
        fs.writeFileSync(this.resumeTxtPath, parsedText, 'utf8');
      }
    } catch (err) {
      console.warn('[ResumeParser] PDF text extraction warning:', err.message);
    }

    // Extract key entities
    const extracted = this.extractProfileFields(parsedText);
    
    // Automatically generate 15+ job titles from CV using Groq AI
    const generatedJobTitles = await this.generateJobTitlesWithGroq(parsedText);

    return {
      success: true,
      size: buffer.length,
      path: this.resumePdfPath,
      textLength: parsedText.length,
      extracted,
      generatedJobTitles
    };
  }

  /**
   * Analyze candidate resume text using Groq AI (via secure Cloudflare Gateway or local key) to extract/generate at least 15 matching job titles
   */
  async generateJobTitlesWithGroq(resumeText) {
    let text = resumeText || '';
    if ((!text || text.length < 50) && fs.existsSync(this.resumePdfPath)) {
      try {
        const buf = fs.readFileSync(this.resumePdfPath);
        text = await this.extractTextFromPdfBuffer(buf);
        if (text && text.trim().length > 0) {
          fs.writeFileSync(this.resumeTxtPath, text, 'utf8');
        }
      } catch (_) {}
    }

    if (!text || text.length < 50) {
      return this.fallbackJobTitles(text);
    }

    const prompt = `You are an expert technical recruiter and ATS career advisor.
Analyze the candidate's resume text below and extract/generate at least 15 high-matching, specific job titles and search keywords for this candidate to apply to.
The job titles must be realistic, highly relevant to their actual skills and experience, and tailored for tech platforms like LinkedIn, Wellfound, and Ashby.

Candidate Resume Text:
"""
${text.substring(0, 3500)}
"""

Return ONLY a valid JSON array of at least 15 strings (job titles). Do NOT include markdown code fences or other text.
Example format:
["AI Engineer", "Machine Learning Engineer", "LLM Engineer", "RAG Systems Engineer", ...]`;

    try {
      const cloudGateway = require('./cloudAiGateway');
      const payload = {
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: 'You are an expert technical recruiter. Output valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 450
      };

      let data;
      try {
        data = await cloudGateway.callChatCompletions(payload, { requestType: 'cv_analysis' });
      } catch (gwErr) {
        console.warn('[ResumeParser] Gateway call note:', gwErr.message);
        // Fallback to local Groq key if available
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (res.ok) data = await res.json();
        }
        if (!data) throw gwErr;
      }

      if (data) {
        const content = data.choices?.[0]?.message?.content || '';
        const cleanJson = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        const titles = JSON.parse(cleanJson);
        if (Array.isArray(titles) && titles.length >= 10) {
          console.log(`[ResumeParser] ✓ AI Gateway generated ${titles.length} job titles from CV!`);
          return titles;
        }
      }
    } catch (err) {
      console.warn('[ResumeParser] AI job titles extraction note:', err.message);
    }

    return this.fallbackJobTitles(text);
  }

  fallbackJobTitles(text = '') {
    const lower = (text || '').toLowerCase();
    const titles = new Set();

    if (lower.includes('ai') || lower.includes('artificial intelligence') || lower.includes('machine learning')) {
      titles.add('AI Engineer');
      titles.add('Machine Learning Engineer');
      titles.add('Generative AI Engineer');
      titles.add('LLM Engineer');
      titles.add('RAG Systems Engineer');
      titles.add('AI Agent Developer');
      titles.add('AI Platform Engineer');
      titles.add('Deep Learning Engineer');
      titles.add('AI Solutions Architect');
    }

    if (lower.includes('python')) {
      titles.add('Python Developer');
      titles.add('Senior Python Engineer');
      titles.add('Python Backend Developer');
    }

    if (lower.includes('react') || lower.includes('javascript') || lower.includes('typescript') || lower.includes('frontend')) {
      titles.add('Full Stack Engineer');
      titles.add('Frontend Engineer');
      titles.add('React Developer');
      titles.add('Software Engineer');
    }

    if (lower.includes('fastapi') || lower.includes('django') || lower.includes('node') || lower.includes('backend')) {
      titles.add('Backend Engineer');
      titles.add('API Engineer');
      titles.add('Software Engineer');
    }

    // Default guaranteed baseline of at least 15 titles
    const baseline = [
      'AI Engineer',
      'Generative AI Engineer',
      'Machine Learning Engineer',
      'LLM Engineer',
      'RAG Systems Engineer',
      'AI Agent Developer',
      'Python Developer',
      'Full Stack AI Engineer',
      'Software Engineer',
      'Backend Engineer',
      'AI Solutions Architect',
      'Data Scientist',
      'MLOps Engineer',
      'AI Integration Engineer',
      'Applied AI Engineer',
      'Full Stack Developer'
    ];

    baseline.forEach(t => titles.add(t));
    return Array.from(titles).slice(0, 20);
  }

  /**
   * Simple NLP extraction for candidate profile fields from raw resume text
   */
  extractProfileFields(text) {
    if (!text || text.length === 0) return {};

    const extracted = {};

    // 1. Email extraction
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) extracted.email = emailMatch[0];

    // 2. Phone extraction (international or standard)
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
    if (phoneMatch) extracted.phone = phoneMatch[0].trim();

    // 3. Name extraction (typically first 1-2 non-empty lines)
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2 && !l.includes('@'));
    if (lines.length > 0) {
      const candidateName = lines[0].replace(/[^\w\s]/gi, '').trim();
      if (candidateName && candidateName.split(' ').length <= 4) {
        extracted.fullName = candidateName;
        const parts = candidateName.split(' ');
        extracted.firstName = parts[0];
        extracted.lastName = parts.slice(1).join(' ');
      }
    }

    // 4. LinkedIn & GitHub URLs
    const linkedinMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
    if (linkedinMatch) extracted.linkedin = linkedinMatch[0];

    const githubMatch = text.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
    if (githubMatch) extracted.github = githubMatch[0];

    // 5. Skills extraction
    const commonSkills = [
      'Python', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'FastAPI', 'Django',
      'Machine Learning', 'Artificial Intelligence', 'Deep Learning', 'LLM', 'RAG',
      'LangChain', 'LangGraph', 'PyTorch', 'TensorFlow', 'Docker', 'Kubernetes',
      'SQL', 'PostgreSQL', 'MongoDB', 'AWS', 'GCP', 'Azure', 'Git', 'Data Science'
    ];

    const foundSkills = [];
    const lowerText = text.toLowerCase();
    for (const skill of commonSkills) {
      if (lowerText.includes(skill.toLowerCase())) {
        foundSkills.push(skill);
      }
    }
    extracted.skills = foundSkills;

    return extracted;
  }
}

module.exports = new ResumeParser();
