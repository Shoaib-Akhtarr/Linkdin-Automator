const aiOpt = require('../engine/aiCvOptimizer');
const masterProfile = require('../engine/masterProfile');

// Mock a fake matchAnalysis
const fakeAnalysis = {
  skills: {
    required: { verified: [{ name: 'LangChain' }, { name: 'RAG Pipelines' }], missing: [] },
    preferred: { verified: [], missing: [] }
  },
  gaps: { criticalGaps: [], familiarGaps: [] }
};

const mockLLMOutput = {
  tailoredTitle: 'Junior AI Engineer (LLM Systems)',
  tailoredProgressionRole: 'Junior LLM Systems Engineer',
  tailoredSummary: 'BS Computer Science student with ~2 years experience specializing in LangChain and RAG pipelines. Built enterprise semantic search and multi-agent workflows using LangChain, Qdrant, and FastAPI at AppEvolve. Ready to bring verified LLM engineering skills to drive measurable impact at TestCorp.',
  tailoredExperienceBullets: [
    'Build LLM applications and RAG pipelines using LangChain and Qdrant to power enterprise semantic search.',
    'Develop multi-agent workflows using LangGraph with cyclic state graphs for automated task coordination.',
    'Train and fine-tune ML models using PyTorch and Scikit-Learn, benchmarking against test baselines.',
    'Implement FastAPI REST endpoints and containerize services with Docker for reliable deployment.'
  ],
  selectedProjects: [
    {
      name: 'Fine-Tuning and Evaluation Framework',
      techStack: ['PyTorch', 'Hugging Face', 'Python'],
      bullets: [
        'Applied LoRA fine-tuning to open-source foundation models improving output schema adherence.',
        'Benchmarked LLM outputs on faithfulness and accuracy metrics using automated evaluation suites.'
      ]
    }
  ]
};

const result = aiOpt.enforceIntegrity(
  mockLLMOutput,
  masterProfile,
  fakeAnalysis,
  'test',
  'test-model',
  { title: 'LLM Engineer', company: 'TestCorp' }
);

console.log('✅ tailoredTitle:', result.tailoredTitle);
console.log('✅ tailoredProgressionRole:', result.tailoredProgressionRole);
console.log('✅ Summary (first 120 chars):', result.tailoredSummary.substring(0, 120));
console.log('✅ Experience bullets:', result.tailoredExperienceBullets.length);
console.log('✅ Projects:', result.selectedProjects.length);
console.log('');

// Now test full tailorProfileAsync integration by mocking AI result
const cvTailor = require('../engine/cvTailor');
const testJob = {
  title: 'Junior ML Engineer',
  company: 'DataAI Corp',
  description: 'Machine learning engineer role with PyTorch, model training, feature engineering, and FastAPI deployment.',
  location: 'Remote'
};

const tailored = cvTailor.tailorProfile(testJob);

// Simulate AI applying progressionRole to the experience
const internPart = tailored.experience[0].role.split('->')[0].trim();
tailored.experience[0].role = `${internPart} -> Junior ML Engineer`;

console.log('✅ Experience role after AI progression:', tailored.experience[0].role);
console.log('✅ Summary (3 sentences check):');
const sentences = tailored.summary.split('. ');
sentences.forEach((s, i) => console.log(`  Sentence ${i + 1}: ${s.substring(0, 80)}...`));

// Generate HTML and check
const html = cvTailor.generateATSHTML(tailored);
const hasRoleArrow = html.includes('role-arrow');
const hasSummary = html.includes('Professional Summary');
const hasRoleTo = html.includes('Junior ML Engineer');

console.log('');
console.log('✅ HTML role-arrow rendered:', hasRoleArrow);
console.log('✅ HTML has Professional Summary section:', hasSummary);
console.log('✅ HTML has Junior ML Engineer in role:', hasRoleTo);
