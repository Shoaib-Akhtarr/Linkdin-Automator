/**
 * Unified Hybrid Job Description (JD) Analyzer
 * 
 * Flow:
 * 1. Checks Local Ollama (qwen2.5:3b-instruct). Fast, offline, zero rate limits.
 * 2. If Ollama is down, seamlessly fails over to Hugging Face Space (shoaib158/Space11).
 * 3. Compares JD against candidate profile (data/profile.json) and outputs:
 *    - 1. Top 10 ATS keywords from the JD
 *    - 2. Skills from candidate profile to mention
 *    - 3. Up to 3 projects to include, 1 line each
 *    - 4. Missing skills
 *    - 5. Overall CV-Job match percentage
 * 
 * Usage:
 *   node scripts/analyze_jd.js
 *   node scripts/analyze_jd.js "path/to/jd.txt"
 */

const fs = require('fs');
const path = require('path');

const PROFILE_PATH = path.join(__dirname, '..', 'data', 'profile.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'settings.json');

const DEFAULT_JD = `
Job Title: ML/AI Platform Engineer
Company: Global FinTech Core
Location: Remote

Key Requirements:
- Hands-on experience with Databricks Workflows, Delta Lake, Unity Catalog, and MLflow.
- Build and maintain CI/CD pipelines, platform automation, observability, and incident response.
- Experience with model serving architectures, APIs, and scalable inference systems.
- Demonstrated operational excellence, reliability, and AI safety controls.
- Knowledge of financial institutions and regulatory compliance.
`;

function loadCandidateProfile() {
  if (fs.existsSync(PROFILE_PATH)) {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
  }
  return { personal: { fullName: 'Shoaib Akhtar', targetTitle: 'AI Engineer' } };
}

function loadSettings() {
  if (fs.existsSync(SETTINGS_PATH)) {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  }
  return {};
}

async function isOllamaAlive(host, timeoutMs = 2000) {
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function runHybridJDAnalysis() {
  console.log('=====================================================');
  console.log('⚡ UNIFIED HYBRID JD ANALYZER');
  console.log('   Level 1: Local Ollama (qwen2.5:3b-instruct)');
  console.log('   Level 2: Hugging Face Space (shoaib158/Space11)');
  console.log('=====================================================\n');

  const profile = loadCandidateProfile();
  const settings = loadSettings();
  const aiCfg = settings.aiOptimizer || {};
  const ollamaHost = aiCfg.ollama?.host || 'http://127.0.0.1:11434';
  const ollamaModel = aiCfg.ollama?.model || 'qwen2.5:3b-instruct';
  const hfSpaceId = aiCfg.hfSpace?.spaceId || 'shoaib158/Space11';

  // Read target JD
  let jdText = DEFAULT_JD;
  const args = process.argv.slice(2);
  if (args.length > 0) {
    if (fs.existsSync(args[0])) {
      jdText = fs.readFileSync(args[0], 'utf-8');
      console.log(`✓ Loaded JD from file: ${args[0]}`);
    } else {
      jdText = args.join(' ');
      console.log('✓ Using JD passed via arguments.');
    }
  } else {
    console.log('ℹ️ Using default target ML/AI Platform Engineer JD.');
  }

  // Extract candidate verified skills
  const verifiedSkills = [];
  if (profile.skills) {
    for (const cat of Object.values(profile.skills)) {
      if (Array.isArray(cat)) {
        for (const s of cat) {
          if (s.status === 'verified') verifiedSkills.push(s.name);
        }
      }
    }
  }

  // --- STEP 1: TEST LOCAL OLLAMA ---
  console.log(`\n🔍 Probing Level 1: Local Ollama at ${ollamaHost}...`);
  const ollamaUp = await isOllamaAlive(ollamaHost, 2000);

  if (ollamaUp) {
    console.log(`✅ Local Ollama is ONLINE. Analyzing with ${ollamaModel}...`);
    const prompt = `You are an expert ATS technical career advisor.
Compare the following Job Description (JD) with the Candidate's verified profile.

CANDIDATE PROFILE:
- Name: ${profile.personal?.fullName || 'Shoaib Akhtar'}
- Role: ${profile.personal?.targetTitle || 'AI Engineer'}
- Verified Skills: ${verifiedSkills.join(', ')}
- Verified Projects: ${profile.projects?.map(p => `"${p.name}" (${p.techStack.join(', ')})`).join('; ') || ''}

JOB DESCRIPTION:
${jdText}

INSTRUCTIONS:
Provide a strictly structured response with these 5 sections:
1. Top 10 ATS keywords from the JD (bullet list)
2. Skills from my profile to mention (bullet list of overlapping skills candidate actually has)
3. Up to 3 projects to include, 1 line each, using JD keywords (select ONLY from candidate's verified projects)
4. Missing skills (bullet list of required/preferred skills in JD missing from candidate profile)
5. Overall CV-job match percentage (e.g. 70% with 1-sentence rationale)

RULES:
- Do NOT invent or fabricate any skills or projects.
- Be concise, professional, and clear.`;

    const start = Date.now();
    try {
      const res = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.2 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const durationSec = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`\n=====================================================`);
        console.log(`📊 ANALYSIS REPORT (Generated via Local Ollama in ${durationSec}s):`);
        console.log(`=====================================================\n`);
        console.log(data.response);
        console.log('\n=====================================================');
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Local Ollama query failed (${e.message}). Falling back to Level 2...`);
    }
  } else {
    console.log(`ℹ️ Local Ollama is offline. Seamlessly failing over to Level 2 (Hugging Face Space)...`);
  }

  // --- STEP 2: FALLBACK TO HUGGING FACE SPACE ---
  console.log(`\n☁️ Connecting to Level 2: Hugging Face Space (${hfSpaceId})...`);
  const startHF = Date.now();
  try {
    const { Client } = await import('@gradio/client');
    const app = await Client.connect(hfSpaceId);
    console.log(`✓ Connected to Space! Sending JD to /analyze endpoint...`);

    const result = await app.predict('/analyze', { jd: jdText });
    const durationSec = ((Date.now() - startHF) / 1000).toFixed(1);
    const output = Array.isArray(result.data) ? result.data[0] : result.data;

    console.log(`\n=====================================================`);
    console.log(`📊 ANALYSIS REPORT (Generated via Hugging Face Space in ${durationSec}s):`);
    console.log(`=====================================================\n`);
    console.log(output);
    console.log('\n=====================================================');
  } catch (hfErr) {
    console.error(`❌ Hugging Face Space also failed: ${hfErr.message}`);
    console.log(`🛡️ Level 3: Falling back to deterministic rule engine.`);
    const jdAnalyzer = require('../engine/jdAnalyzer');
    const analysis = jdAnalyzer.analyze({ description: jdText });
    console.log(JSON.stringify(analysis, null, 2));
  }
}

runHybridJDAnalysis();
