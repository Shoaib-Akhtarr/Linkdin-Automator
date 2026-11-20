/**
 * Soft Touch Cold Outreach Generator (Step 2 Strategy)
 * Generates concise, non-pushy 3-sentence outreach messages for LinkedIn & Twitter/X,
 * matching candidate's real stack to the specific company and role.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE_FILE = path.join(__dirname, '..', 'config', 'profile.json');

function loadProfile() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    personal: {
      fullName: 'Shoaib Akhtar',
      headline: 'AI Engineer | LLM & Multi-Agent Systems',
      links: { github: 'https://github.com/Shoaib-Akhtarr' }
    }
  };
}

class OutreachGenerator {
  constructor() {
    this.profile = loadProfile();
  }

  /**
   * Determine matching project / highlights based on role title and tech stack
   */
  getHighlightSnippet(title = '', stack = '') {
    const combined = `${title} ${stack}`.toLowerCase();
    
    if (/devops|sre|site reliability|cloud|platform|infrastructure|kubernetes|terraform/i.test(combined)) {
      return 'scalable cloud infrastructure, Kubernetes container orchestration, and zero-downtime CI/CD pipelines with Terraform and cloud platforms';
    }
    if (/\.net|dotnet|c#|asp\.net|csharp|azure developer/i.test(combined)) {
      return 'high-throughput enterprise backends using ASP.NET Core, C#, Entity Framework, and resilient microservices architectures on Azure';
    }
    if (/agent|multi-agent|autonomous|crewai|langgraph/i.test(combined)) {
      return 'autonomous multi-agent workflows and real-time LLM architectures using LangGraph and CrewAI';
    }
    if (/rag|vector|retrieval|embedding|pinecone|qdrant/i.test(combined)) {
      return 'production RAG pipelines with vector databases (Qdrant, ChromaDB) and hybrid search';
    }
    if (/ml|machine learning|deep learning|pytorch|tensorflow|vision|cv|speech/i.test(combined)) {
      return 'end-to-end ML model fine-tuning and high-throughput inference pipelines using PyTorch and FastAPI';
    }
    if (/backend|python|fastapi|api|microservice/i.test(combined)) {
      return 'scalable Python/FastAPI microservices with asynchronous task queues and Docker containerization';
    }
    if (/full.?stack|frontend|react|typescript|node/i.test(combined)) {
      return 'modern full-stack web applications with Next.js/React, TypeScript, and high-performance backends';
    }
    return 'scalable AI systems and multi-agent pipelines with Python and LLM integrations';
  }

  /**
   * Generates outreach pack for a job
   */
  generateOutreach(company, role, options = {}) {
    const cleanCompany = (company || 'the team').trim();
    const cleanRole = (role || 'Software Engineer').trim();
    const recipientName = options.recipientName || '[Name]';
    const highlight = options.customHighlight || this.getHighlightSnippet(cleanRole, options.stack || '');
    const myName = (this.profile.personal?.fullName || 'Shoaib Akhtar').split(' ')[0];

    // 1. Engineering Manager / Team Lead template
    const emNote = `Hi ${recipientName}, saw the ${cleanRole} opening at ${cleanCompany} and just submitted my application directly on your careers page. I've recently built ${highlight}, which directly aligns with your technical direction. Looking forward to hopefully connecting with the team!`;

    // 2. Founder / CTO template (Early-stage & YC)
    const founderNote = `Hi ${recipientName}, huge fan of what you're building at ${cleanCompany}—just applied for the ${cleanRole} role on your site. I specialize in ${highlight} and would love to contribute to accelerating the roadmap. Best of luck with the growth!`;

    // 3. One-click search links to locate the hiring manager
    const encodedComp = encodeURIComponent(cleanCompany);
    const linkedInSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodedComp}+%28%22Engineering+Manager%22+OR+%22Head+of+Engineering%22+OR+%22CTO%22+OR+%22Tech+Lead%22+OR+%22Founder%22%29`;
    const twitterSearchUrl = `https://x.com/search?q=${encodedComp}+%28%22engineer%22+OR+%22founder%22+OR+%22CTO%22%29&f=user`;

    return {
      company: cleanCompany,
      role: cleanRole,
      engineeringManagerNote: emNote,
      founderNote: founderNote,
      links: {
        findOnLinkedIn: linkedInSearchUrl,
        findOnTwitter: twitterSearchUrl
      }
    };
  }
}

module.exports = new OutreachGenerator();
