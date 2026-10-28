/**
 * Job Description (JD) Analyzer & Gap Detection Engine
 * 
 * Responsibilities:
 * 1. Parse JD into Required vs. Preferred vs. General sections
 * 2. Extract technical competencies and tools
 * 3. Match against Candidate's Single Source of Truth (data/profile.json)
 * 4. Separate Required-skill coverage from Preferred-skill coverage (weighted scoring)
 * 5. Identify genuine gaps (critical missing vs. familiar learning gaps)
 * 6. Provide actionable recommendations without arbitrary hard rejection
 */

const masterProfile = require('./masterProfile');

// Comprehensive dictionary of technical skills and tools across modern AI engineering
const SKILL_CATALOG = [
  // Generative AI & Agents
  { name: 'LangChain', aliases: ['langchain'] },
  { name: 'LangGraph', aliases: ['langgraph'] },
  { name: 'CrewAI', aliases: ['crewai'] },
  { name: 'AutoGen', aliases: ['autogen'] },
  { name: 'LlamaIndex', aliases: ['llamaindex', 'llama-index'] },
  { name: 'DSPy', aliases: ['dspy'] },
  { name: 'Semantic Kernel', aliases: ['semantic kernel'] },
  { name: 'RAG Pipelines', aliases: ['rag', 'retrieval-augmented generation', 'retrieval augmented generation'] },
  { name: 'Prompt Engineering', aliases: ['prompt engineering', 'prompt optimization'] },
  { name: 'Model Fine-Tuning', aliases: ['fine-tuning', 'fine tuning', 'peft', 'lora', 'qlora', 'instruction tuning'] },
  { name: 'LLMs', aliases: ['llm', 'llms', 'large language models', 'foundation models'] },
  { name: 'Hugging Face', aliases: ['hugging face', 'huggingface', 'transformers'] },
  { name: 'OpenAI API', aliases: ['openai', 'gpt-4', 'chatgpt api'] },
  { name: 'Anthropic', aliases: ['anthropic', 'claude'] },
  { name: 'Cohere API', aliases: ['cohere'] },
  { name: 'vLLM', aliases: ['vllm'] },
  { name: 'Ollama', aliases: ['ollama'] },
  { name: 'DeepEval', aliases: ['deepeval'] },
  { name: 'Ragas', aliases: ['ragas'] },
  { name: 'Guardrails', aliases: ['guardrails', 'nemo guardrails'] },

  // Vector DBs
  { name: 'Qdrant', aliases: ['qdrant'] },
  { name: 'ChromaDB', aliases: ['chromadb', 'chroma'] },
  { name: 'FAISS', aliases: ['faiss'] },
  { name: 'Pinecone', aliases: ['pinecone'] },
  { name: 'Weaviate', aliases: ['weaviate'] },
  { name: 'Milvus', aliases: ['milvus'] },

  // Machine Learning & Data Science
  { name: 'PyTorch', aliases: ['pytorch', 'torch'] },
  { name: 'TensorFlow', aliases: ['tensorflow', 'tf', 'keras'] },
  { name: 'Scikit-Learn', aliases: ['scikit-learn', 'scikit learn', 'sklearn'] },
  { name: 'XGBoost', aliases: ['xgboost'] },
  { name: 'LightGBM', aliases: ['lightgbm'] },
  { name: 'NumPy', aliases: ['numpy'] },
  { name: 'Pandas', aliases: ['pandas'] },
  { name: 'Matplotlib', aliases: ['matplotlib'] },
  { name: 'Seaborn', aliases: ['seaborn'] },
  { name: 'Polars', aliases: ['polars'] },
  { name: 'Computer Vision', aliases: ['computer vision', 'opencv', 'cv'] },
  { name: 'NLP', aliases: ['nlp', 'natural language processing', 'spacy', 'nltk'] },
  { name: 'Feature Engineering', aliases: ['feature engineering'] },
  { name: 'Model Evaluation', aliases: ['model evaluation', 'model validation', 'metrics'] },
  { name: 'Statistical Analysis', aliases: ['statistical analysis', 'statistics', 'hypothesis testing'] },

  // Programming Languages
  { name: 'Python', aliases: ['python', 'py'] },
  { name: 'SQL', aliases: ['sql', 'postgresql', 'postgres', 'mysql'] },
  { name: 'JavaScript', aliases: ['javascript', 'js'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'C++', aliases: ['c++', 'cpp'] },
  { name: 'Java', aliases: ['java'] },
  { name: 'Go', aliases: ['golang', 'go'] },
  { name: 'Rust', aliases: ['rust'] },
  { name: 'Bash', aliases: ['bash', 'shell scripting'] },

  // Backend Frameworks
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Node.js', aliases: ['node.js', 'nodejs', 'express'] },
  { name: 'Streamlit', aliases: ['streamlit'] },
  { name: 'REST APIs', aliases: ['rest api', 'rest apis', 'restful'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'gRPC', aliases: ['grpc'] },

  // MLOps, Cloud & DevOps
  { name: 'Docker', aliases: ['docker', 'containerization'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'Helm', aliases: ['helm'] },
  { name: 'CI/CD (GitHub Actions)', aliases: ['ci/cd', 'github actions', 'gitlab ci'] },
  { name: 'Git', aliases: ['git', 'version control'] },
  { name: 'Linux', aliases: ['linux', 'ubuntu'] },
  { name: 'AWS (EC2, S3)', aliases: ['aws', 'amazon web services', 's3', 'ec2', 'lambda', 'sagemaker'] },
  { name: 'Azure AI', aliases: ['azure', 'azure ai', 'azure ml'] },
  { name: 'GCP', aliases: ['gcp', 'google cloud', 'vertex ai'] },
  { name: 'MLflow', aliases: ['mlflow'] },
  { name: 'Airflow', aliases: ['airflow', 'apache airflow'] },
  { name: 'Kafka', aliases: ['kafka', 'apache kafka'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch', 'opensearch'] }
];

class JDAnalyzer {
  constructor(profile = masterProfile) {
    this.profile = profile;
    this.catalog = SKILL_CATALOG;
  }

  /**
   * Split JD into functional sections: Required, Preferred, and Responsibilities
   * Uses both header pattern matching and line-level linguistic cues.
   */
  parseSections(text = '') {
    if (!text || typeof text !== 'string') {
      return { requiredText: '', preferredText: '', otherText: '' };
    }

    const lines = text.split(/\r?\n/);
    let currentSection = 'other'; // default
    const sections = {
      required: [],
      preferred: [],
      other: []
    };

    // Header patterns
    const requiredHeaderRegex = /^(?:requirements|minimum qualifications|basic qualifications|what (?:you(?:'ll)? need|you bring)|must[- ]have|qualifications|who you are|what we(?:'re)? looking for|core competencies|key requirements)[\s:]*$/i;
    const preferredHeaderRegex = /^(?:preferred qualifications|preferred skills|nice[- ]to[- ]have|bonus points?|what would be nice|pluses|good to have|desired (?:skills|qualifications)|additional qualifications)[\s:]*$/i;
    const responsibilitiesHeaderRegex = /^(?:responsibilities|what you(?:'ll)? do|key duties|role overview|your impact|about the role)[\s:]*$/i;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Check for section headers
      if (requiredHeaderRegex.test(line)) {
        currentSection = 'required';
        continue;
      }
      if (preferredHeaderRegex.test(line)) {
        currentSection = 'preferred';
        continue;
      }
      if (responsibilitiesHeaderRegex.test(line)) {
        currentSection = 'other';
        continue;
      }

      // If we are in 'other', check for sentence-level cues if headers were absent
      if (currentSection === 'other') {
        const lower = line.toLowerCase();
        if (/\b(?:must have|required|minimum of|proficiency in|essential)\b/i.test(lower)) {
          sections.required.push(line);
          continue;
        } else if (/\b(?:nice to have|preferred|bonus|plus if|familiarity with)\b/i.test(lower)) {
          sections.preferred.push(line);
          continue;
        }
      }

      sections[currentSection].push(line);
    }

    // Fallback: If no required section was identified via headers, treat the entire text as general/required
    let requiredText = sections.required.join('\n');
    let preferredText = sections.preferred.join('\n');
    let otherText = sections.other.join('\n');

    if (!requiredText && !preferredText) {
      requiredText = otherText;
      otherText = '';
    }

    return { requiredText, preferredText, otherText };
  }

  /**
   * Extract recognized technical skills from a text snippet
   */
  extractSkillsFromText(text = '') {
    if (!text) return [];
    const lower = text.toLowerCase();
    const matched = [];

    for (const entry of this.catalog) {
      const isMatched = entry.aliases.some(alias => {
        // Safe regex word boundary matching
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
        return regex.test(lower);
      });

      if (isMatched && !matched.includes(entry.name)) {
        matched.push(entry.name);
      }
    }

    return matched;
  }

  /**
   * Classify candidate skills into Verified, Familiar, or Missing for a given skill name
   */
  lookupSkillStatus(skillName) {
    const raw = this.profile.raw || {};
    const skillCategories = raw.skills || {};

    const cleanName = skillName.toLowerCase();

    for (const cat of Object.keys(skillCategories)) {
      for (const item of skillCategories[cat]) {
        if (item.name.toLowerCase() === cleanName || cleanName.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(cleanName)) {
          return {
            name: item.name,
            status: item.status, // 'verified' or 'familiar'
            evidence: item.evidence || '',
            category: cat
          };
        }
      }
    }

    return {
      name: skillName,
      status: 'missing',
      evidence: '',
      category: 'untracked'
    };
  }

  /**
   * Perform comprehensive JD analysis and truthful gap detection
   * @param {Object} job - { title: string, company: string, description: string }
   * @returns {Object} Full match breakdown and decision guidance
   */
  analyze(job = {}) {
    const title = job.title || '';
    const company = job.company || '';
    const description = job.description || '';

    // 1. Parse sections
    const { requiredText, preferredText, otherText } = this.parseSections(description);

    // 2. Extract skills by section
    const rawRequiredSkills = this.extractSkillsFromText(requiredText);
    let rawPreferredSkills = this.extractSkillsFromText(preferredText);
    const rawOtherSkills = this.extractSkillsFromText(otherText);

    // Deduplicate: If in required, don't duplicate in preferred or other
    rawPreferredSkills = rawPreferredSkills.filter(s => !rawRequiredSkills.includes(s));
    const otherUniqueSkills = rawOtherSkills.filter(s => !rawRequiredSkills.includes(s) && !rawPreferredSkills.includes(s));

    // 3. Evaluate Required Skills against Candidate Profile
    const requiredEvaluated = rawRequiredSkills.map(s => this.lookupSkillStatus(s));
    const requiredVerified = requiredEvaluated.filter(s => s.status === 'verified');
    const requiredFamiliar = requiredEvaluated.filter(s => s.status === 'familiar');
    const requiredMissing = requiredEvaluated.filter(s => s.status === 'missing');

    // 4. Evaluate Preferred Skills against Candidate Profile
    const preferredEvaluated = rawPreferredSkills.map(s => this.lookupSkillStatus(s));
    const preferredVerified = preferredEvaluated.filter(s => s.status === 'verified');
    const preferredFamiliar = preferredEvaluated.filter(s => s.status === 'familiar');
    const preferredMissing = preferredEvaluated.filter(s => s.status === 'missing');

    // 5. Coverage Calculations
    const requiredTotal = rawRequiredSkills.length;
    const preferredTotal = rawPreferredSkills.length;

    const requiredCoverage = requiredTotal > 0
      ? Math.round((requiredVerified.length / requiredTotal) * 100)
      : 100;

    const preferredCoverage = preferredTotal > 0
      ? Math.round((preferredVerified.length / preferredTotal) * 100)
      : 100;

    // Weighted match score: 75% weight on required, 25% on preferred
    let weightedScore = 100;
    if (requiredTotal > 0 && preferredTotal > 0) {
      weightedScore = Math.round((requiredCoverage * 0.75) + (preferredCoverage * 0.25));
    } else if (requiredTotal > 0) {
      weightedScore = requiredCoverage;
    } else if (preferredTotal > 0) {
      weightedScore = preferredCoverage;
    }

    // 6. Categorize Gaps
    const criticalGaps = requiredMissing.map(s => s.name);
    const familiarGaps = [
      ...requiredFamiliar.map(s => `${s.name} (Required)`),
      ...preferredFamiliar.map(s => `${s.name} (Preferred)`)
    ];
    const bonusGaps = preferredMissing.map(s => s.name);

    // 7. Recommendation (Guidance, not arbitrary binary rejection)
    let recommendation = 'HIGH_CONFIDENCE_MATCH';
    let guidance = '';

    if (requiredCoverage >= 75 && criticalGaps.length <= 1) {
      recommendation = 'HIGH_CONFIDENCE_MATCH';
      guidance = `Strong candidate match (${requiredCoverage}% required coverage). Verified in core stack (${requiredVerified.map(s => s.name).slice(0, 3).join(', ')}). High probability of interview traction.`;
    } else if (requiredCoverage >= 50) {
      recommendation = 'MODERATE_MATCH';
      guidance = `Solid match (${requiredCoverage}% required coverage). Core foundation is verified, but note ${criticalGaps.length} critical gap(s): [${criticalGaps.join(', ')}]. Apply with tailored emphasis.`;
    } else {
      recommendation = 'STRETCH_ROLE';
      guidance = `Stretch opportunity (${requiredCoverage}% required coverage). Key prerequisites missing: [${criticalGaps.join(', ')}]. Consider applying if interested in the domain, but prepare for prerequisite questions.`;
    }

    return {
      job: { title, company },
      metrics: {
        weightedScore,
        requiredCoverage,
        preferredCoverage,
        requiredCount: { total: requiredTotal, verified: requiredVerified.length, familiar: requiredFamiliar.length, missing: requiredMissing.length },
        preferredCount: { total: preferredTotal, verified: preferredVerified.length, familiar: preferredFamiliar.length, missing: preferredMissing.length }
      },
      skills: {
        required: {
          verified: requiredVerified.map(s => ({ name: s.name, evidence: s.evidence })),
          familiar: requiredFamiliar.map(s => ({ name: s.name, evidence: s.evidence })),
          missing: requiredMissing.map(s => s.name)
        },
        preferred: {
          verified: preferredVerified.map(s => ({ name: s.name, evidence: s.evidence })),
          familiar: preferredFamiliar.map(s => ({ name: s.name, evidence: s.evidence })),
          missing: preferredMissing.map(s => s.name)
        },
        otherMentioned: otherUniqueSkills
      },
      gaps: {
        criticalGaps,
        familiarGaps,
        bonusGaps
      },
      recommendation: {
        rating: recommendation,
        guidance
      }
    };
  }
}

module.exports = new JDAnalyzer();
