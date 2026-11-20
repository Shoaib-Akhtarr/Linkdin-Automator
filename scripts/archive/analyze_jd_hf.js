/**
 * Hugging Face Space JD Analyzer Client
 * Calls shoaib158/Space11 via @gradio/client
 * 
 * Usage:
 *   node scripts/analyze_jd_hf.js
 *   node scripts/analyze_jd_hf.js "path/to/jd.txt"
 */

const fs = require('fs');
const path = require('path');

// Default sample JD if none provided
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

async function callHFSpace(jdText) {
  const { Client } = await import('@gradio/client');

  console.log('=====================================================');
  console.log('🚀 CALLING HUGGING FACE SPACE (shoaib158/Space11)');
  console.log('=====================================================\n');

  console.log('⏳ Connecting to Hugging Face Space: shoaib158/Space11...');
  const app = await Client.connect('shoaib158/Space11');
  console.log('✓ Connected successfully!\n');

  console.log('⏳ Sending JD to /analyze endpoint...');
  const startTime = Date.now();
  
  const result = await app.predict('/analyze', {
    jd: jdText
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✓ Response received in ${durationSec}s!\n`);

  console.log('=====================================================');
  console.log('📋 JD ANALYSIS REPORT:');
  console.log('=====================================================\n');

  const outputText = Array.isArray(result.data) ? result.data[0] : result.data;
  console.log(outputText);
  console.log('\n=====================================================');
}

// Read args
const args = process.argv.slice(2);
let jd = DEFAULT_JD;

if (args.length > 0) {
  if (fs.existsSync(args[0])) {
    jd = fs.readFileSync(args[0], 'utf-8');
    console.log(`✓ Loaded JD from file: ${args[0]}`);
  } else {
    jd = args.join(' ');
  }
}

callHFSpace(jd).catch(err => {
  console.error('❌ Error calling Hugging Face Space:', err.message);
});
