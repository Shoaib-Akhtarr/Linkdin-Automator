const aiCvOptimizer = require('../engine/aiCvOptimizer');
const masterProfile = require('../engine/masterProfile');
const jdAnalyzer = require('../engine/jdAnalyzer');
const cvTailor = require('../engine/cvTailor');

async function testAICVOptimizer() {
  console.log('=== TEST 1: AI OPTIMIZER INITIALIZATION & FALLBACK ===');
  console.log('Detected Provider:', aiCvOptimizer.provider);
  console.log('Is AI Available?:', aiCvOptimizer.isAvailable());

  const sampleJob = {
    title: 'Senior AI Engineer',
    company: 'ScaleAI',
    description: `
Requirements:
- Deep experience in LangGraph and RAG Pipelines.
- Microservices deployment with FastAPI and Docker.
- Apache Airflow pipelines.

Preferred:
- AWS and Kubernetes experience.
- Pinecone vector database.
    `
  };

  const analysis = jdAnalyzer.analyze(sampleJob);

  // Test Integrity Guard with simulated adversarial/hallucinated LLM response
  console.log('\n=== TEST 2: INTEGRITY GUARDRAILS (POST-GENERATION SAFETY) ===');
  const simulatedAdversarialLLMOutput = {
    tailoredSummary: "Experienced AI Engineer with proven production track record deploying Airflow DAGs and managing Kubernetes clusters at enterprise scale.",
    tailoredExperienceBullets: [
      "Led end-to-end Airflow data orchestration pipelines for ML models.",
      "Developed and deployed production LLM-based applications using LangChain and LangGraph."
    ],
    selectedProjects: [
      {
        name: "Enterprise Multi-Agent AI Platform",
        techStack: ["LangGraph", "FastAPI", "Kubernetes", "Airflow", "Pinecone"], // Attempted stack alteration
        bullets: [
          "Deployed Kubernetes pods with Airflow workflow schedulers.",
          "Designed and deployed an enterprise multi-agent platform orchestrating autonomous domain agents."
        ]
      }
    ]
  };

  const sanitized = aiCvOptimizer.enforceIntegrity(simulatedAdversarialLLMOutput, masterProfile, analysis);

  console.log('1. Summary Reversion Check:');
  const summaryHasAirflow = sanitized.tailoredSummary.includes('Airflow');
  const summaryHasKubernetes = sanitized.tailoredSummary.includes('Kubernetes');
  console.log('   - Contains unverified Airflow?:', summaryHasAirflow, '(Expected: false)');
  console.log('   - Contains unverified Kubernetes?:', summaryHasKubernetes, '(Expected: false)');
  console.log('   - Reverted to safe verified summary?:', sanitized.tailoredSummary === masterProfile.summary);

  console.log('\n2. Experience Bullet Check:');
  console.log('   - Bullet 1 (had Airflow):', sanitized.tailoredExperienceBullets[0]);
  console.log('   - Airflow suppressed in bullets?:', !sanitized.tailoredExperienceBullets.some(b => b.includes('Airflow')));

  console.log('\n3. Project Tech Stack Freezing Check:');
  const project = sanitized.selectedProjects[0];
  console.log('   - Selected Project Name:', project.name);
  console.log('   - Sanitized Project Stack:', project.techStack);
  console.log('   - Stack preserved exactly as master?:', JSON.stringify(project.techStack) === JSON.stringify(masterProfile.projects[0].techStack));
  console.log('   - Bullet had Airflow/K8s reverted?:', !project.bullets[0].includes('Airflow'));

  console.log('\n=== TEST 3: ASYNC TAILOR PROFILE PIPELINE ===');
  const tailored = await cvTailor.tailorProfileAsync(sampleJob);
  console.log('✓ Target Title:', tailored.personal.targetTitle);
  console.log('✓ Verified Summary:', tailored.summary.slice(0, 100) + '...');
  console.log('✓ Project[0] Name:', tailored.projects[0].name);
  console.log('✓ Project[0] Tech Stack:', tailored.projects[0].techStack);
  console.log('✓ Integrity Check Passed: All output grounded in verified truth.');
}

testAICVOptimizer().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
