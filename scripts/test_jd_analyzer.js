const jdAnalyzer = require('../engine/jdAnalyzer');

const sampleJD = {
  title: 'AI Engineer (Generative AI)',
  company: 'ScaleAI',
  description: `
About the Role:
We are looking for an AI Engineer to build next-generation autonomous agent systems and enterprise RAG workflows.

Requirements:
- Strong proficiency in Python and REST APIs (FastAPI).
- Hands-on experience developing agentic workflows with LangChain or LangGraph.
- Experience building RAG pipelines with vector databases such as Qdrant or ChromaDB.
- Solid understanding of Docker and containerization.
- Experience with Apache Airflow for data pipeline scheduling.

Preferred Qualifications:
- Familiarity with Kubernetes and cloud environments (AWS).
- Experience fine-tuning open-source LLMs using PyTorch or Hugging Face.
- Familiarity with Pinecone or Weaviate.
  `
};

const result = jdAnalyzer.analyze(sampleJD);

console.log('=== JD ANALYSIS REPORT ===');
console.log('Job:', result.job.title, 'at', result.job.company);
console.log('Weighted Match Score:', result.metrics.weightedScore + '%');
console.log('Required Skill Coverage:', result.metrics.requiredCoverage + '% (' + result.metrics.requiredCount.verified + '/' + result.metrics.requiredCount.total + ')');
console.log('Preferred Skill Coverage:', result.metrics.preferredCoverage + '% (' + result.metrics.preferredCount.verified + '/' + result.metrics.preferredCount.total + ')');

console.log('\n=== SKILLS BREAKDOWN ===');
console.log('Verified Required Skills:', result.skills.required.verified.map(s => s.name));
console.log('Critical Gaps (Missing Required):', result.gaps.criticalGaps);
console.log('Familiar Gaps (Needs prep):', result.gaps.familiarGaps);
console.log('Bonus Gaps (Missing Preferred):', result.gaps.bonusGaps);

console.log('\n=== TEST 2: STRETCH ROLE (DevOps / Systems) ===');
const stretchJD = {
  title: 'Senior MLOps & Systems Engineer',
  company: 'Robotics Corp',
  description: `
Requirements:
- Minimum 5 years of C++ and Go systems development.
- Deep expertise in Kubernetes cluster management and Helm.
- Production Kafka streaming and Apache Airflow.

Preferred:
- Python scripting.
- Docker experience.
  `
};

const result2 = jdAnalyzer.analyze(stretchJD);
console.log('Job:', result2.job.title);
console.log('Weighted Match Score:', result2.metrics.weightedScore + '%');
console.log('Required Coverage:', result2.metrics.requiredCoverage + '% (' + result2.metrics.requiredCount.verified + '/' + result2.metrics.requiredCount.total + ')');
console.log('Critical Gaps:', result2.gaps.criticalGaps);
console.log('Familiar Gaps:', result2.gaps.familiarGaps);
console.log('Recommendation:', result2.recommendation.rating);
console.log('Guidance:', result2.recommendation.guidance);
