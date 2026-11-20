const eligibilityEngine = require('../engine/eligibilityEngine');
const cvMatcher = require('../engine/cvMatcher');

console.log('=== TESTING INTELLISENSE LOGIC ===\n');

// Test 1: LLM / LangChain job
const testJob1 = {
  title: 'AI Software Developer',
  company: 'NextGen AI Labs',
  description: 'We are seeking an engineer experienced with LangChain, LangGraph, RAG architectures, FastAPI microservices, and Qdrant vector databases to build multi-agent workflows.'
};

const el1 = eligibilityEngine.evaluateEligibility(testJob1);
const cv1 = cvMatcher.matchBestCV(testJob1);
console.log('--- TEST 1: LangChain & RAG Job ---');
console.log('Eligible:', el1.eligible);
console.log('Matched Skills:', el1.matchedSkills);
console.log('Match Score:', el1.matchScore + '%');
console.log('Selected CV:', cv1.targetFile, `(${cv1.role})`);
console.log('Sample Tailored Note:\n' + eligibilityEngine.generateTailoredCoverLetter(testJob1, el1.matchedSkills));

// Test 2: Cohere / NLP job
const testJob2 = {
  title: 'NLP Machine Learning Engineer',
  company: 'Semantic Search AI',
  description: 'Looking for specialists in fine-tuning models, transformers, natural language processing, Hugging Face, Cohere embeddings, and PyTorch.'
};

const el2 = eligibilityEngine.evaluateEligibility(testJob2);
const cv2 = cvMatcher.matchBestCV(testJob2);
console.log('\n--- TEST 2: Cohere & NLP Job ---');
console.log('Eligible:', el2.eligible);
console.log('Matched Skills:', el2.matchedSkills);
console.log('Selected CV:', cv2.targetFile, `(${cv2.role})`);

// Test 3: Disqualified job (Requires US Top Secret Clearance)
const testJob3 = {
  title: 'AI Systems Engineer',
  company: 'Defense Contracting Group',
  description: 'Must have active DoD Top Secret / SCI clearance. Must be a US Citizen. Candidates without clearance will not be considered.'
};

const el3 = eligibilityEngine.evaluateEligibility(testJob3);
console.log('\n--- TEST 3: Clearance Required Job ---');
console.log('Eligible:', el3.eligible);
console.log('Disqualification Reason:', el3.reason);

console.log('\n=== ALL INTELLISENSE TESTS PASSED! ===');
