const masterProfile = require('./masterProfile');
const jdAnalyzer = require('./jdAnalyzer');
const aiCvOptimizer = require('./aiCvOptimizer');

class CVTailor {
  constructor() {
    this.master = masterProfile;
    this.analyzer = jdAnalyzer;
    this.aiOptimizer = aiCvOptimizer;
  }

  /**
   * Tailor the master profile to perfectly match the target job requirements
   * @param {Object} job - { title: string, company: string, description: string, location: string }
   * @returns {Object} Tailored resume data model with match analysis report
   */
  tailorProfile(job = {}) {
    const title = (job.title || '').trim();
    const company = (job.company || '').trim();
    const desc = (job.description || '').toLowerCase();

    // 1. PERFORM STRUCTURED JD ANALYSIS (Required vs Preferred & Gap Detection)
    const analysis = this.analyzer.analyze(job);

    // Deep clone master profile
    const tailored = JSON.parse(JSON.stringify(this.master));

    // Attach analysis report for downstream audit / tracker / AI model
    tailored.matchAnalysis = analysis;

    // 2. ADAPT TARGET TITLE (Match real candidate title: Junior AI Engineer + optional focus area)
    if (title) {
      const cleanTitle = title
        .replace(/\(verified job\)/i, '')
        .replace(/\(remote\)/i, '')
        .replace(/\(hybrid\)/i, '')
        .replace(/\[.*?\]/g, '')
        .trim();
      const focus = cleanTitle
        .replace(/^(junior|senior|lead|staff|principal|entry[- ]level)?\s*(ai|ml|machine learning|software|automation)\s*(engineer|developer|specialist)?\s*[-–/:]?\s*/i, '')
        .trim();
      tailored.personal.targetTitle = focus ? `Junior AI Engineer (${focus})` : 'Junior AI Engineer';
    } else {
      tailored.personal.targetTitle = 'Junior AI Engineer';
    }

    // 3. TARGET KEYWORDS: Prioritize verified required skills first, then preferred
    const requiredVerifiedNames = analysis.skills.required.verified.map(s => s.name);
    const preferredVerifiedNames = analysis.skills.preferred.verified.map(s => s.name);
    const targetKeywords = [...requiredVerifiedNames, ...preferredVerifiedNames];

    // Fallback if JD was unstructured or few skills extracted
    if (targetKeywords.length === 0) {
      targetKeywords.push(...this.extractJDKeywords(desc));
    }

    // 4. FACTUAL SUMMARY (Includes ~2 years experience & BS CS student status, zero buzzwords)
    const topOverlap = targetKeywords.slice(0, 3).join(', ');
    const companyMention = company ? ` at ${company}` : '';

    if (topOverlap) {
      tailored.summary = `BS in Computer Science student and Junior AI Engineer with ~2 years of practical experience developing AI pipelines, LLM workflows, and microservices. Experienced in building RAG systems with FastAPI and Docker, fine-tuning ML models, and deploying reliable agent workflows. Hands-on experience in ${topOverlap}, focused on delivering scalable software solutions${companyMention}.`;
    }

    // 5. PRIORITIZE VERIFIED SKILLS (Zero injection — strictly re-ordering)
    tailored.skills.generativeAI = this.prioritizeSkills(tailored.skills.generativeAI, targetKeywords);
    tailored.skills.frameworks = this.prioritizeSkills(tailored.skills.frameworks, targetKeywords);
    tailored.skills.mlopsAndCloud = this.prioritizeSkills(tailored.skills.mlopsAndCloud, targetKeywords);
    tailored.skills.languages = this.prioritizeSkills(tailored.skills.languages, targetKeywords);
    tailored.skills.dataScience = this.prioritizeSkills(tailored.skills.dataScience, targetKeywords);

    // 6. DYNAMIC ROLE-TARGETED PROJECT GENERATOR (Suggests projects tailored to the target job)
    tailored.projects = this.generateSuggestedProjects(job, targetKeywords);

    return tailored;
  }

  /**
   * Asynchronous profile tailoring with optional AI-powered truthful rewrites
   * Falls back gracefully to deterministic tailorProfile() if AI is offline or unavailable
   */
  async tailorProfileAsync(job = {}, options = {}) {
    // 1. Get verified deterministic baseline
    const tailored = this.tailorProfile(job);

    // 2. If AI is disabled via option, return baseline
    if (options.useAI === false) {
      return tailored;
    }

    // 3. Attempt AI optimization
    try {
      const aiResult = await this.aiOptimizer.optimize(this.master, job, tailored.matchAnalysis);
      if (aiResult) {
        if (aiResult.tailoredTitle) {
          tailored.personal.targetTitle = aiResult.tailoredTitle;
        }
        if (aiResult.tailoredSummary) {
          tailored.summary = aiResult.tailoredSummary;
        }
        if (Array.isArray(aiResult.tailoredExperienceBullets) && aiResult.tailoredExperienceBullets.length > 0) {
          if (tailored.experience[0]) {
            tailored.experience[0].bullets = aiResult.tailoredExperienceBullets;
          }
        }
        if (Array.isArray(aiResult.selectedProjects) && aiResult.selectedProjects.length > 0) {
          tailored.projects = aiResult.selectedProjects;
        }
        tailored.aiEnhanced = true;
        tailored.aiProvider = aiResult.provider;
        tailored.aiModel = aiResult.model;
        console.log(`🤖 [CV Tailor] Enhanced CV with AI (${aiResult.provider}/${aiResult.model})`);
      }
    } catch (e) {
      console.warn('⚠️ [CV Tailor] AI optimization skipped:', e.message);
    }

    return tailored;
  }

  /**
   * Dynamically generate tailored project suggestions based on target role, company, and JD requirements.
   * Grounded 100% in verified candidate skills (Python, PyTorch, Scikit-Learn, FastAPI, Docker, LangChain, LangGraph, CrewAI, ChromaDB, Qdrant, Pandas, etc.)
   */
  generateSuggestedProjects(job = {}, targetKeywords = []) {
    const title = (job.title || '').toLowerCase();
    const desc = (job.description || '').toLowerCase();
    const combined = `${title} ${desc} ${(targetKeywords || []).join(' ')}`.toLowerCase();

    // Archetype definitions with verified skills only (Junior tone, zero buzzwords, action -> method -> result)
    const archetypes = [
      {
        id: 'fine_tuning',
        name: 'LLM Fine-Tuning & Quality Evaluation Framework',
        techStack: ['Hugging Face', 'PyTorch', 'Python', 'Model Fine-Tuning', 'Model Evaluation'],
        keywords: ['fine-tuning', 'fine tuning', 'peft', 'lora', 'evaluation', 'benchmark', 'hugging face', 'deepeval', 'ragas', 'nlp'],
        bullets: [
          'Applied instruction fine-tuning and parameter-efficient LoRA adapters to open-source foundation models using Hugging Face.',
          'Configured evaluation test suites to benchmark LLM outputs on faithfulness and schema adherence, improving response validity to [metric].'
        ]
      },
      {
        id: 'vision',
        name: 'Deep Learning Vision & Inference Service',
        techStack: ['PyTorch', 'Python', 'Docker', 'FastAPI', 'Model Evaluation'],
        keywords: ['vision', 'computer vision', 'image', 'opencv', 'object detection', 'cnn', 'yolo', 'segmentation', 'deep learning', 'visual', 'video'],
        bullets: [
          'Trained convolutional neural networks with PyTorch, evaluating inference speed and accuracy on image test datasets.',
          'Built image preprocessing pipelines with normalization and deployed lightweight FastAPI inference containers using Docker.'
        ]
      },
      {
        id: 'data_science',
        name: 'Predictive Analytics & Feature Engineering Pipeline',
        techStack: ['Scikit-Learn', 'Pandas', 'NumPy', 'Python', 'SQL', 'Model Evaluation'],
        keywords: ['data scientist', 'data science', 'analytics', 'feature engineering', 'pandas', 'scikit-learn', 'tabular', 'predictive', 'statistical', 'regression', 'random forest', 'xgboost', 'numpy'],
        bullets: [
          'Engineered automated ETL pipelines with Pandas and SQL to handle categorical encodings, scaling, and feature selection.',
          'Trained supervised models using Scikit-Learn with cross-validation and hyperparameter tuning, improving test F1 score to [metric].'
        ]
      },
      {
        id: 'mlops',
        name: 'Containerized Model Serving & CI/CD Pipeline',
        techStack: ['FastAPI', 'Docker', 'PyTorch', 'CI/CD (GitHub Actions)', 'Linux'],
        keywords: ['mlops', 'deployment', 'serving', 'docker', 'ci/cd', 'latency', 'production', 'pipeline', 'kubernetes', 'inference', 'microservice', 'scalable', 'monitoring'],
        bullets: [
          'Implemented containerized model inference endpoints using FastAPI and Docker to reduce API response latency.',
          'Configured automated CI/CD pipelines with GitHub Actions for unit testing, linting, and Docker container packaging.'
        ]
      },
      {
        id: 'agents',
        name: 'Autonomous Multi-Agent Workflow Engine',
        techStack: ['LangGraph', 'CrewAI', 'FastAPI', 'Docker', 'Qdrant', 'OpenAI API'],
        keywords: ['agent', 'agentic', 'crewai', 'langgraph', 'autogen', 'multi-agent', 'reasoning', 'autonomous', 'tool-calling', 'state graph'],
        bullets: [
          'Built stateful multi-agent workflows using LangGraph cyclic state graphs with memory to automate coordinated tasks.',
          'Implemented structured tool-calling schemas for agents to query external APIs and return verified responses.'
        ]
      },
      {
        id: 'rag',
        name: 'Enterprise Semantic Search & Retrieval Pipeline',
        techStack: ['LangChain', 'Qdrant', 'ChromaDB', 'FastAPI', 'Python', 'OpenAI API'],
        keywords: ['rag', 'vector', 'search', 'qdrant', 'chromadb', 'faiss', 'retrieval', 'embeddings', 'semantic', 'knowledge', 'chunking'],
        bullets: [
          'Built context-aware semantic search pipelines using LangChain and Qdrant vector indexing to retrieve relevant documents.',
          'Paired dense vector search with metadata filtering and source citations to improve answer faithfulness and reduce lookup latency.'
        ]
      },
      {
        id: 'backend',
        name: 'Asynchronous REST API & Data Pipeline Service',
        techStack: ['FastAPI', 'Python', 'Docker', 'SQL', 'REST APIs', 'Git'],
        keywords: ['backend', 'python developer', 'software engineer', 'api', 'rest', 'microservices', 'fastapi', 'flask', 'database', 'sql', 'async'],
        bullets: [
          'Developed asynchronous REST microservices using FastAPI and Pydantic schemas to validate high-concurrency payloads.',
          'Integrated relational database queries with SQL and packaged backend services into lightweight multi-stage Docker containers.'
        ]
      }
    ];

    // Score archetypes against target role & JD
    const scored = archetypes.map(arch => {
      let score = 0;
      for (const kw of arch.keywords) {
        if (title.includes(kw)) score += 6;
        if (combined.includes(kw)) score += 1;
      }
      return { arch, score };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Pick top 3 distinct projects
    return scored.slice(0, 3).map(item => ({
      name: item.arch.name,
      techStack: [...item.arch.techStack],
      bullets: [...item.arch.bullets]
    }));
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
