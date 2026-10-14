const masterProfile = require('./masterProfile');

class CVTailor {
  constructor() {
    this.master = masterProfile;
  }

  /**
   * Tailor the master profile to perfectly match the target job requirements
   * @param {Object} job - { title: string, company: string, description: string, location: string }
   * @returns {Object} Tailored resume data model
   */
  tailorProfile(job = {}) {
    const title = (job.title || '').trim();
    const company = (job.company || '').trim();
    const desc = (job.description || '').toLowerCase();

    // Deep clone master profile
    const tailored = JSON.parse(JSON.stringify(this.master));

    // 1. ADAPT TITLE HEADER
    if (title) {
      // Clean up common LinkedIn suffixes like "(Verified job)", "(Remote)", etc.
      const cleanTitle = title
        .replace(/\(verified job\)/i, '')
        .replace(/\(remote\)/i, '')
        .replace(/\(hybrid\)/i, '')
        .replace(/\[.*?\]/g, '')
        .trim();
      tailored.personal.targetTitle = cleanTitle || 'AI Engineer';
    }

    // 2. EXTRACT TECHNICAL KEYWORDS FROM JD
    const targetKeywords = this.extractJDKeywords(desc);

    // 3. ADAPT PROFESSIONAL SUMMARY
    const topKeywordsStr = targetKeywords.slice(0, 4).join(', ');
    const companyMention = company ? ` at ${company}` : '';

    if (topKeywordsStr) {
      tailored.summary = `Analytical and results-driven AI Engineer specializing in Artificial Intelligence, LLMs, and high-performance production systems. Experienced in architecting end-to-end RAG pipelines, deploying scalable microservices with FastAPI and Docker, fine-tuning ML models, and building autonomous agent workflows. Proficient in ${topKeywordsStr}, with a proven track record of transforming complex requirements into reliable, production-ready AI solutions${companyMention}.`;
    }

    // 4. TAILOR TECHNICAL SKILLS LIST
    // Prioritize keywords detected in the JD at the top of each category
    const prioritizedGenAI = this.prioritizeSkills(tailored.skills.generativeAI, targetKeywords);
    const prioritizedFrameworks = this.prioritizeSkills(tailored.skills.frameworks, targetKeywords);
    const prioritizedCloud = this.prioritizeSkills(tailored.skills.mlopsAndCloud, targetKeywords);

    // If new relevant keywords from JD are found (e.g. vLLM, Pinecone, DSPy), append them
    for (const kw of targetKeywords) {
      const alreadyIncluded = [
        ...prioritizedGenAI,
        ...prioritizedFrameworks,
        ...prioritizedCloud,
        ...tailored.skills.languages
      ].some(s => s.toLowerCase().includes(kw.toLowerCase()));

      if (!alreadyIncluded) {
        if (/vllm|ollama|dspy|deepeval|ragas|guardrails|bedrock/i.test(kw)) {
          prioritizedGenAI.unshift(kw);
        } else if (/airflow|prometheus|grafana|helm/i.test(kw)) {
          prioritizedCloud.unshift(kw);
        }
      }
    }

    tailored.skills.generativeAI = prioritizedGenAI;
    tailored.skills.frameworks = prioritizedFrameworks;
    tailored.skills.mlopsAndCloud = prioritizedCloud;

    // 5. TAILOR PROJECT TECH STACKS
    for (const project of tailored.projects) {
      for (const kw of targetKeywords) {
        if (!project.techStack.includes(kw) && project.techStack.length < 6) {
          if (desc.includes(kw.toLowerCase())) {
            // Include matching stack where relevant
            if (/qdrant|chromadb|faiss|pinecone|weaviate/i.test(kw) && /vector/i.test(project.name)) {
              project.techStack.push(kw);
            }
          }
        }
      }
    }

    return tailored;
  }

  /**
   * Extract key frameworks, libraries, and tools mentioned in the JD
   */
  extractJDKeywords(desc) {
    if (!desc) return [];
    const candidates = [
      'LangChain', 'LangGraph', 'CrewAI', 'AutoGen', 'LlamaIndex',
      'RAG', 'vLLM', 'Ollama', 'DSPy', 'DeepEval', 'Ragas',
      'FastAPI', 'Flask', 'Docker', 'Kubernetes', 'CI/CD',
      'PyTorch', 'TensorFlow', 'Scikit-Learn', 'XGBoost',
      'Qdrant', 'ChromaDB', 'FAISS', 'Pinecone', 'Weaviate',
      'Cohere', 'OpenAI', 'Anthropic', 'Hugging Face',
      'AWS', 'Azure', 'GCP', 'PostgreSQL', 'MongoDB', 'Redis',
      'MLflow', 'Airflow', 'Kafka'
    ];

    const matched = [];
    for (const kw of candidates) {
      const regex = new RegExp(`\\b${kw.replace('+', '\\+')}\\b`, 'i');
      if (regex.test(desc)) {
        matched.push(kw);
      }
    }
    return matched;
  }

  /**
   * Prioritize skills matching target keywords to the front
   */
  prioritizeSkills(skillList, targetKeywords) {
    const list = [...skillList];
    return list.sort((a, b) => {
      const aMatches = targetKeywords.some(k => a.toLowerCase().includes(k.toLowerCase()));
      const bMatches = targetKeywords.some(k => b.toLowerCase().includes(k.toLowerCase()));
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
  }

  /**
   * Generate clean, standard single-column ATS semantic HTML
   * Designed specifically to achieve 95%+ parse accuracy on Workday, Taleo, Greenhouse, and LinkedIn ATS.
   */
  generateATSHTML(tailoredData) {
    const p = tailoredData.personal;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHTML(p.fullName)} - ${escapeHTML(p.targetTitle)} Resume</title>
  <style>
    @page {
      size: A4;
      margin: 12mm 14mm 12mm 14mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Arial, Helvetica, "Segoe UI", sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #111111;
      background: #ffffff;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      text-align: center;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1.5px solid #222222;
    }
    .name {
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .target-title {
      font-size: 11pt;
      font-weight: 600;
      color: #2563eb;
      margin-bottom: 4px;
    }
    .contact-line {
      font-size: 8.5pt;
      color: #475569;
    }
    .contact-line a {
      color: #2563eb;
      text-decoration: none;
    }
    .section {
      margin-top: 10px;
      margin-bottom: 8px;
    }
    .section-title {
      font-size: 10.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 2px;
      margin-bottom: 6px;
    }
    .summary-text {
      font-size: 9.2pt;
      line-height: 1.4;
      color: #334155;
      text-align: justify;
    }
    .skills-grid {
      display: table;
      width: 100%;
      font-size: 8.8pt;
    }
    .skills-row {
      display: table-row;
      line-height: 1.45;
    }
    .skills-label {
      display: table-cell;
      font-weight: 700;
      color: #1e293b;
      width: 24%;
      padding-bottom: 3px;
    }
    .skills-value {
      display: table-cell;
      color: #334155;
      width: 76%;
      padding-bottom: 3px;
    }
    .job-item, .project-item {
      margin-bottom: 8px;
    }
    .job-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 2px;
    }
    .job-title-company {
      font-size: 9.8pt;
      font-weight: 700;
      color: #0f172a;
    }
    .job-company {
      color: #2563eb;
      font-weight: 600;
    }
    .job-date-loc {
      font-size: 8.5pt;
      font-weight: 500;
      color: #64748b;
    }
    ul.bullet-list {
      list-style-type: disc;
      margin-left: 16px;
      margin-top: 2px;
    }
    ul.bullet-list li {
      font-size: 8.8pt;
      line-height: 1.35;
      color: #334155;
      margin-bottom: 2.5px;
      text-align: justify;
    }
    .tech-badge {
      font-weight: 600;
      color: #0f172a;
    }
    .edu-item, .cert-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .cert-list {
      margin-top: 4px;
    }
    .cert-item-text {
      font-size: 8.8pt;
      color: #334155;
      margin-bottom: 2px;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="name">${escapeHTML(p.fullName)}</div>
    <div class="target-title">${escapeHTML(p.targetTitle)}</div>
    <div class="contact-line">
      ${escapeHTML(p.location)} &nbsp;|&nbsp; 
      ${escapeHTML(p.phone)} &nbsp;|&nbsp; 
      ${escapeHTML(p.email)} &nbsp;|&nbsp; 
      <a href="https://${escapeHTML(p.linkedin)}">${escapeHTML(p.linkedin)}</a> &nbsp;|&nbsp; 
      <a href="https://${escapeHTML(p.github)}">${escapeHTML(p.github)}</a>
    </div>
  </div>

  <!-- Professional Summary -->
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${escapeHTML(tailoredData.summary)}</div>
  </div>

  <!-- Technical Skills -->
  <div class="section">
    <div class="section-title">Technical Skills</div>
    <div class="skills-grid">
      <div class="skills-row">
        <div class="skills-label">Languages:</div>
        <div class="skills-value">${escapeHTML(tailoredData.skills.languages.join(', '))}</div>
      </div>
      <div class="skills-row">
        <div class="skills-label">Generative AI & LLMs:</div>
        <div class="skills-value">${escapeHTML(tailoredData.skills.generativeAI.join(', '))}</div>
      </div>
      <div class="skills-row">
        <div class="skills-label">Frameworks & APIs:</div>
        <div class="skills-value">${escapeHTML(tailoredData.skills.frameworks.join(', '))}</div>
      </div>
      <div class="skills-row">
        <div class="skills-label">MLOps & Cloud:</div>
        <div class="skills-value">${escapeHTML(tailoredData.skills.mlopsAndCloud.join(', '))}</div>
      </div>
      <div class="skills-row">
        <div class="skills-label">Data Science & Tools:</div>
        <div class="skills-value">${escapeHTML(tailoredData.skills.dataScience.join(', '))}</div>
      </div>
    </div>
  </div>

  <!-- Professional Experience -->
  <div class="section">
    <div class="section-title">Work Experience</div>
    ${tailoredData.experience.map(exp => `
      <div class="job-item">
        <div class="job-header">
          <div class="job-title-company">
            <span>${escapeHTML(exp.role)}</span> &nbsp;—&nbsp; <span class="job-company">${escapeHTML(exp.company)}</span>
          </div>
          <div class="job-date-loc">${escapeHTML(exp.period)} &nbsp;|&nbsp; ${escapeHTML(exp.location)}</div>
        </div>
        <ul class="bullet-list">
          ${exp.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
  </div>

  <!-- Key AI Projects -->
  <div class="section">
    <div class="section-title">Key AI & Machine Learning Projects</div>
    ${tailoredData.projects.map(proj => `
      <div class="project-item">
        <div class="job-header">
          <div class="job-title-company">
            <span>${escapeHTML(proj.name)}</span>
          </div>
          <div class="job-date-loc tech-badge">${escapeHTML(proj.techStack.join(' • '))}</div>
        </div>
        <ul class="bullet-list">
          ${proj.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
  </div>

  <!-- Education & Certifications (Compact Bottom) -->
  <div class="section">
    <div class="section-title">Education & Certifications</div>
    ${tailoredData.education.map(edu => `
      <div class="edu-item">
        <div class="job-title-company">
          <span>${escapeHTML(edu.degree)}</span> &nbsp;—&nbsp; <span class="job-company">${escapeHTML(edu.institution)}</span>
        </div>
        <div class="job-date-loc">${escapeHTML(edu.period)}</div>
      </div>
    `).join('')}
    <div class="cert-list">
      ${tailoredData.certifications.map(cert => `
        <div class="cert-item-text">
          <strong>${escapeHTML(cert.name)}</strong> &nbsp;—&nbsp; ${escapeHTML(cert.issuer)} (${escapeHTML(cert.description)})
        </div>
      `).join('')}
    </div>
  </div>

</body>
</html>`;
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = new CVTailor();
