/**
 * Generate a test CV PDF and save it to the Desktop
 */

const pdfRenderer = require('../engine/pdfRenderer');
const path = require('path');
const fs = require('fs');

const desktopPath = path.join(require('os').homedir(), 'OneDrive', 'Desktop');

const testJob = {
  title: 'Junior LLM Engineer',
  company: 'OpenAI',
  description: `We are looking for a Junior LLM Engineer to join our team. 
  You will work with LangChain, RAG pipelines, vector databases (Qdrant, ChromaDB), 
  prompt engineering, and model fine-tuning using Hugging Face and PyTorch. 
  Experience with FastAPI for serving LLM endpoints and Docker for containerization is required. 
  Familiarity with LangGraph for multi-agent orchestration is a strong plus. 
  You should be comfortable with Python and have hands-on experience building AI-powered applications.`,
  location: 'Remote'
};

async function main() {
  console.log('🚀 Generating test CV for:', testJob.title, '@', testJob.company);
  console.log('');

  try {
    const result = await pdfRenderer.renderTailoredCV(testJob);

    // Copy to Desktop
    const desktopFile = path.join(desktopPath, 'Shoaib_Akhtar_TEST_CV.pdf');
    fs.copyFileSync(result.filePath, desktopFile);

    console.log('');
    console.log('✅ CV Generated Successfully!');
    console.log('📄 File saved to Desktop:', desktopFile);
    console.log('📦 File size:', Math.round(result.fileSize / 1024), 'KB');
    console.log('🛡️  Validation score:', result.validation?.auditScore, '/ 100');

    if (result.tailoredData) {
      const d = result.tailoredData;
      console.log('');
      console.log('=== CV CONTENT PREVIEW ===');
      console.log('🏷️  Header Title :', d.personal?.targetTitle);
      console.log('💼 Experience Role:', d.experience?.[0]?.role);
      console.log('');
      console.log('📋 PROFESSIONAL SUMMARY:');
      const sentences = (d.summary || '').split(/(?<=\.) /);
      sentences.forEach((s, i) => console.log(`  [${i+1}] ${s.trim()}`));
      console.log('');
      console.log('📌 EXPERIENCE BULLETS:');
      (d.experience?.[0]?.bullets || []).forEach((b, i) => {
        console.log(`  ${i+1}. ${b}`);
      });
      console.log('');
      console.log('📁 PROJECTS:');
      (d.projects || []).forEach((p, i) => {
        console.log(`  ${i+1}. ${p.name} [${p.techStack.join(', ')}]`);
      });
    }

  } catch (err) {
    console.error('❌ Error generating CV:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
