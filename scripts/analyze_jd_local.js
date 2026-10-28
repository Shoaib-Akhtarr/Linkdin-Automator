/**
 * Local JD Analyzer CLI using Ollama & Qwen2.5-3B-Instruct
 * 
 * Usage:
 *   node scripts/analyze_jd_local.js
 *   node scripts/analyze_jd_local.js "path/to/jd.txt"
 */

const fs = require('fs');
const path = require('path');

const PROFILE_PATH = path.join(__dirname, '..', 'data', 'profile.json');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

// Default Sample Job Description if none provided via args
const DEFAULT_JD = `
Job Title: AI Engineer (Generative AI & Agentic Systems)
Company: NextGen AI Solutions
Location: Remote

About the Role:
We are seeking an AI Engineer to develop autonomous agent workflows and scalable RAG systems.

Key Responsibilities:
- Design, implement, and deploy production-grade RAG pipelines and autonomous agent architectures (LangGraph, CrewAI).
- Integrate vector databases (Qdrant, Chroma, FAISS) for low-latency dense semantic retrieval.
- Build resilient backend microservices with FastAPI, Docker, and Python.
- Evaluate LLM performance, latency, and reliability using automated guardrails.
- Collaborate with frontend engineers to integrate conversational streaming interfaces.

Required Qualifications & Skills:
- 2+ years experience building production LLM applications and agentic workflows.
- Strong proficiency in Python, FastAPI, and Docker.
- Hands-on experience with LangChain, LangGraph, or LlamaIndex.
- Experience with Vector Databases (Qdrant, Pinecone, or ChromaDB).
- Solid understanding of prompt engineering, fine-tuning (LoRA/PEFT), and RAG evaluation.

Preferred Qualifications:
- Experience with Kubernetes orchestration and cloud deployments (AWS/GCP).
- Knowledge of Apache Airflow or Kafka for data streaming.
- Open-source contributions or deployed AI side projects.
`;

async function runLocalAnalysis() {
  console.log('=====================================================');
  console.log('🤖 LOCAL JD ANALYZER (Ollama + Qwen2.5-3B-Instruct)');
  console.log('=====================================================\n');

  // 1. Load candidate profile
  let candidateData = {};
  if (fs.existsSync(PROFILE_PATH)) {
    candidateData = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
    console.log(`✓ Loaded candidate profile for: ${candidateData.personal?.fullName || 'Candidate'} (${candidateData.personal?.targetTitle || 'AI Engineer'})`);
  } else {
    console.warn('⚠️ profile.json not found, using generic profile context.');
  }

  // 2. Read input JD
  let jdText = DEFAULT_JD;
  const args = process.argv.slice(2);
  if (args.length > 0) {
    if (fs.existsSync(args[0])) {
      jdText = fs.readFileSync(args[0], 'utf-8');
      console.log(`✓ Loaded custom JD from file: ${args[0]}`);
    } else {
      jdText = args.join(' ');
      console.log('✓ Using JD passed via command line arguments.');
    }
  } else {
    console.log('ℹ️ No custom JD argument provided. Using default sample AI Engineer JD.');
  }

  // Extract candidate verified skills
  const allVerifiedSkills = [];
  if (candidateData.skills) {
    for (const category of Object.values(candidateData.skills)) {
      if (Array.isArray(category)) {
        for (const item of category) {
          if (item.status === 'verified') allVerifiedSkills.push(item.name);
        }
      }
    }
  }

  const prompt = `You are an expert technical recruiter and AI career advisor.
Analyze the following Job Description (JD) and compare it against the Candidate's verified profile.

CANDIDATE CV PROFILE:
- Name: ${candidateData.personal?.fullName || 'Candidate'}
- Target Role: ${candidateData.personal?.targetTitle || 'AI Engineer'}
- Verified Skills: ${allVerifiedSkills.join(', ')}
- Summary: ${candidateData.summary || ''}
- Experience Highlights: ${candidateData.experience?.map(e => `${e.role} at ${e.company} (${e.duration})`).join('; ') || ''}

JOB DESCRIPTION:
${jdText}

TASK:
Analyze this job description and extract:
1. Required skills
2. Required experience
3. Key responsibilities
4. Missing skills in my CV (skills mentioned in the JD that are NOT verified in the candidate's profile)
5. Overall CV-job match percentage (0% to 100% based on required vs matched skills)

Provide a clean, structured, and easy-to-read report in Markdown format.`;

  console.log(`\n⏳ Sending request to local Ollama (${MODEL}) at ${OLLAMA_HOST}...\n`);

  const startTime = Date.now();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('=====================================================');
    console.log(`📊 ANALYSIS RESULT (Generated in ${durationSec}s):`);
    console.log('=====================================================\n');
    console.log(data.response);
    console.log('\n=====================================================');
  } catch (err) {
    console.error('❌ Error during local analysis:', err.message);
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      console.error('\nTip: Make sure Ollama is running (`ollama serve`).');
    }
  }
}

runLocalAnalysis();
