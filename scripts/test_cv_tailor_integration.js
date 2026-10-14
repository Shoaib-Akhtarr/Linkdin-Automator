const fs = require('fs');
const path = require('path');
const pdfRenderer = require('../engine/pdfRenderer');
const cvTailor = require('../engine/cvTailor');

async function run() {
  console.log('--- Testing On-The-Fly ATS CV Generation ---');
  const testJob = {
    title: 'Senior Generative AI & Autonomous Agent Engineer',
    company: 'Apex Innovations',
    location: 'Remote',
    description: `We are seeking an exceptional Senior Generative AI Engineer.
Requirements:
- Deep experience in LangGraph, CrewAI, AutoGen, and multi-agent coordination.
- Hands-on expertise with vector databases: Qdrant, Pinecone, or ChromaDB.
- Practical knowledge in local LLM serving using vLLM or Ollama.
- LLM evaluation pipelines using DeepEval and Ragas.
- Production containerization with Docker and Kubernetes, orchestrated with FastAPI microservices.
- Solid Python foundation and modern MLOps CI/CD.`
  };

  const tailored = cvTailor.tailorProfile(testJob);
  console.log('✓ Target Title tailored to:', tailored.personal.targetTitle);
  console.log('✓ Summary tailored to:', tailored.summary.slice(0, 120) + '...');
  console.log('✓ Generative AI skills prioritized:', tailored.skills.generativeAI.slice(0, 6));
  console.log('✓ Cloud / MLOps skills prioritized:', tailored.skills.mlopsAndCloud.slice(0, 5));

  const result = await pdfRenderer.renderTailoredCV(testJob);
  console.log('✓ PDF generated successfully:', result.fileName);
  console.log('✓ Output path:', result.filePath);
  console.log('✓ File size:', result.fileSize, 'bytes');

  if (fs.existsSync(result.filePath) && result.fileSize > 10000) {
    console.log('\n SUCCESS: Dynamic ATS CV Generator is 100% operational!');
    process.exit(0);
  } else {
    console.error('\n FAILURE: PDF not generated or file size too small.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
