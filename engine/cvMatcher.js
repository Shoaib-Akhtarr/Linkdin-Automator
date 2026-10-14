const path = require('path');
const fs = require('fs');

/**
 * Rules mapping job requirements / titles to specific tailored CVs
 */
const CV_RULES = [
  {
    role: 'Generative AI & LLM Engineer',
    targetFile: 'shoaib_akhtar_cv7_ai_engineer.pdf',
    linkedInMatches: ['cv7', 'cv8_ai_engineer', 'ai_engineer'],
    keywords: [
      'generative ai', 'genai', 'llm', 'large language model', 'rag',
      'langchain', 'langgraph', 'crewai', 'autogen', 'prompt engineering',
      'agentic', 'agents', 'vector database', 'chromadb', 'qdrant', 'retrieval'
    ],
    priority: 10
  },
  {
    role: 'Machine Learning & NLP Specialist',
    targetFile: 'shoaib_akhtar_cv6_cohere.pdf',
    linkedInMatches: ['cv6_cohere', 'cohere', 'nlp', 'machine_learning'],
    keywords: [
      'machine learning', 'deep learning', 'nlp', 'natural language',
      'pytorch', 'tensorflow', 'scikit-learn', 'scikit', 'xgboost',
      'model training', 'fine-tuning', 'cohere', 'hugging face'
    ],
    priority: 9
  },
  {
    role: 'Data Scientist & Analytics',
    targetFile: 'cv_data_scientist-1.pdf',
    linkedInMatches: ['data_scientist', 'scientist', 'analytics'],
    keywords: [
      'data scientist', 'data science', 'data analytics', 'data analyst',
      'pandas', 'numpy', 'statistics', 'statistical', 'tableau', 'power bi',
      'sql server', 'eda', 'feature engineering'
    ],
    priority: 8
  },
  {
    role: 'Cloud AI & MLOps Infrastructure',
    targetFile: 'shoaib_akhtar_cv10_cloud_ai.pdf',
    linkedInMatches: ['cloud_ai', 'cloud', 'mlops', 'devops'],
    keywords: [
      'cloud', 'aws', 'azure', 'gcp', 'mlops', 'docker', 'kubernetes',
      'ci/cd', 'deployment', 'pipeline', 'fastapi', 'microservices'
    ],
    priority: 8
  },
  {
    role: 'AI Product & Full Stack Engineer',
    targetFile: 'shoaib_akhtar_cv3.pdf',
    linkedInMatches: ['cv3', 'product', 'software'],
    keywords: [
      'product engineer', 'full stack', 'software engineer', 'fastapi',
      'backend', 'frontend', 'typescript', 'react', 'javascript'
    ],
    priority: 7
  },
  {
    role: 'AI / ML Intern / Junior',
    targetFile: 'shoaib_akhtar_cv2.pdf',
    linkedInMatches: ['cv2', 'intern'],
    keywords: [
      'intern', 'internship', 'junior', 'entry level', 'trainee', 'graduate'
    ],
    priority: 6
  }
];

class CVMatcher {
  constructor() {
    this.rules = CV_RULES;
    this.cvDirectory = path.join('C:', 'Users', 'mshoa', 'OneDrive', 'Desktop', "cv's with Ex");
  }

  /**
   * Determine the most tailored CV based on the job title and description
   * @param {Object} job - { title: string, company: string, description?: string }
   * @returns {{ role: string, targetFile: string, localPath: string, score: number, matches: Array<string> }}
   */
  matchBestCV(job) {
    const textToMatch = `${job.title || ''} ${job.company || ''} ${job.description || ''}`.toLowerCase();

    let bestRule = this.rules[0];
    let highestScore = -1;
    let bestMatches = [];

    for (const rule of this.rules) {
      let score = 0;
      const matched = [];

      // Check job title explicitly (title matches carry 3x weight)
      for (const kw of rule.keywords) {
        if ((job.title || '').toLowerCase().includes(kw)) {
          score += 3;
          matched.push(`Title: "${kw}"`);
        } else if (textToMatch.includes(kw)) {
          score += 1;
          matched.push(kw);
        }
      }

      // Add base priority as tie-breaker
      score += rule.priority * 0.1;

      if (score > highestScore) {
        highestScore = score;
        bestRule = rule;
        bestMatches = matched;
      }
    }

    const localPath = path.join(this.cvDirectory, bestRule.targetFile);
    const exists = fs.existsSync(localPath);

    return {
      role: bestRule.role,
      targetFile: bestRule.targetFile,
      linkedInMatches: bestRule.linkedInMatches,
      localPath: exists ? localPath : path.resolve(__dirname, '..', 'assets', 'resume.pdf'),
      score: Math.round(highestScore),
      matches: bestMatches
    };
  }
}

module.exports = new CVMatcher();
