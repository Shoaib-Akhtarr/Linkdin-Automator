const fs = require('fs');
const path = require('path');

class EligibilityEngine {
  constructor() {
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try {
      const p = path.resolve(__dirname, '..', 'config', 'profile.json');
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      return {};
    }
  }

  /**
   * Analyze the full job description for hard disqualifiers and match strength
   * @param {Object} job - { title: string, company: string, description: string, location: string }
   * @param {Object} settings - engine settings
   * @returns {{ eligible: boolean, reason?: string, matchScore: number, matchedSkills: string[], detectedTimezone?: string }}
   */
  evaluateEligibility(job, settings = {}) {
    const desc = (job.description || '').toLowerCase();
    const title = (job.title || '').toLowerCase();
    const fullText = `${title} ${desc}`;

    const config = settings.intelligence || {
      filterSecurityClearance: true,
      filterCitizenshipRestricted: true,
      minimumMatchScore: 10
    };

    // 1. SECURITY CLEARANCE DISQUALIFIER
    if (config.filterSecurityClearance !== false) {
      const clearancePatterns = [
        /active.*(secret|top secret|ts\/sci|clearance)/i,
        /must (possess|have|hold|maintain).*(security|dod) clearance/i,
        /polygraph (required|examination)/i,
        /itar (clearance|compliance|restricted)/i
      ];

      for (const pat of clearancePatterns) {
        if (pat.test(fullText)) {
          return {
            eligible: false,
            reason: 'Requires Active Security Clearance / Polygraph',
            matchScore: 0,
            matchedSkills: []
          };
        }
      }
    }

    // 2. CITIZENSHIP RESTRICTIONS
    if (config.filterCitizenshipRestricted !== false) {
      const citizenshipPatterns = [
        /must be a (us|u\.s\.|united states) citizen\b/i,
        /u\.s\. citizenship (is )?required/i,
        /us citizens? only\b/i,
        /no c2c|no corp-to-corp/i
      ];

      for (const pat of citizenshipPatterns) {
        if (pat.test(fullText)) {
          return {
            eligible: false,
            reason: 'Requires US Citizenship Only',
            matchScore: 0,
            matchedSkills: []
          };
        }
      }
    }

    // 3. UNWANTED JOB TYPES (Commission only / Unpaid)
    if (/commission only|100% commission|unpaid internship|volunteer position/i.test(fullText)) {
      return {
        eligible: false,
        reason: 'Unwanted job type (Commission only / Unpaid)',
        matchScore: 0,
        matchedSkills: []
      };
    }

    // 4. EXTRACT MATCHING SKILLS FROM JD
    const knownSkills = [
      'Python', 'FastAPI', 'Flask', 'Django',
      'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'Scikit-Learn',
      'Generative AI', 'GenAI', 'LLM', 'RAG', 'LangChain', 'LangGraph', 'CrewAI', 'AutoGen',
      'Prompt Engineering', 'Vector Database', 'ChromaDB', 'Qdrant', 'FAISS', 'Pinecone',
      'Cohere', 'Hugging Face', 'Transformers', 'OpenAI', 'Anthropic',
      'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'MLOps', 'CI/CD',
      'SQL', 'PostgreSQL', 'MongoDB', 'Redis',
      'TypeScript', 'JavaScript', 'React', 'REST API'
    ];

    const matchedSkills = [];
    for (const skill of knownSkills) {
      const regex = new RegExp(`\\b${skill.replace('+', '\\+')}\\b`, 'i');
      if (regex.test(fullText)) {
        matchedSkills.push(skill);
      }
    }

    // 5. DETECT TIMEZONE PREFERENCE IN JD
    let detectedTimezone = null;
    if (/pacific time|pst|pdt/i.test(fullText)) detectedTimezone = 'Pacific Time (PST/PDT)';
    else if (/eastern time|est|edt/i.test(fullText)) detectedTimezone = 'Eastern Time (EST/EDT)';
    else if (/central time|cst|cdt/i.test(fullText)) detectedTimezone = 'Central Time (CST/CDT)';
    else if (/gmt|utc|bst/i.test(fullText)) detectedTimezone = 'GMT/BST';
    else if (/pkt|pakistan/i.test(fullText)) detectedTimezone = 'PKT (Pakistan Time)';

    // 6. CALCULATE MATCH SCORE (0 - 100)
    // Base score from skill matches
    const skillScore = Math.min(matchedSkills.length * 10, 70);
    // Title relevance bonus
    const titleBonus = /ai|artificial intelligence|machine learning|ml|generative|llm|python/i.test(title) ? 25 : 10;
    const matchScore = Math.min(skillScore + titleBonus, 100);

    return {
      eligible: true,
      matchScore,
      matchedSkills,
      detectedTimezone
    };
  }

  /**
   * Generate a tailored cover letter / note specifically referencing the job description
   * @param {Object} job - { title: string, company: string, description: string }
   * @param {Array<string>} matchedSkills - skills detected in JD
   * @returns {string}
   */
  generateTailoredCoverLetter(job, matchedSkills = []) {
    const company = job.company || 'your team';
    const title = job.title || 'AI Engineer';

    const topSkills = matchedSkills.slice(0, 3).join(', ') || 'Python, LangChain, and production LLMs';

    return `Dear ${company} Hiring Team,\n\nI am thrilled to apply for the ${title} position. With 2+ years of hands-on engineering experience designing and deploying scalable AI systems, RAG pipelines, and multi-agent workflows using ${topSkills}, I am confident in delivering immediate value to ${company}.\n\nI look forward to discussing how my technical background aligns with your engineering objectives.\n\nBest regards,\nShoaib Akhtar`;
  }
}

module.exports = new EligibilityEngine();
