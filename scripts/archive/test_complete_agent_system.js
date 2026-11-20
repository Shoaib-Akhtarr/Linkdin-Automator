/**
 * Test Suite: Complete Internal Agent System & Autonomous Self-Healing
 * Verifies:
 * 1. Rule: "for canceling any job to no, make every possible to yes"
 * 2. AI consultation: "This is the problem. Tell me how to resolve it."
 * 3. AI resolution execution with exception handling
 * 4. When AI is clueless -> "Sir, this is the problem we are facing: ... So we are canceling the job apply, you please see another one."
 */

require('../engine/envLoader');
const assert = require('assert');
const questionEngine = require('../engine/questionEngine');
const groqAdvisor = require('../engine/groqAdvisor');
const internalAgentSystem = require('../engine/internalAgentSystem');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TEST 1: Rule "For canceling any job to no, make every possible to yes"');
  console.log('====================================================');

  const testQuestions = [
    { prompt: 'Do you have 2+ years of experience in Python?', type: 'radio', options: ['Yes', 'No'] },
    { prompt: 'Are you legally authorized to work in the United States?', type: 'radio', options: ['Yes', 'No'] },
    { prompt: 'Are you comfortable working in Eastern Standard Time (EST)?', type: 'radio', options: ['Yes', 'No'] },
    { prompt: 'Are you willing to relocate for this position?', type: 'select', options: ['Yes', 'No'] },
    { prompt: 'Do you meet the minimum qualifications listed?', type: 'radio', options: ['Yes', 'No'] },
    { prompt: 'Have you ever been convicted of a felony?', type: 'radio', options: ['Yes', 'No'] } // Negative check
  ];

  for (const q of testQuestions) {
    const evalResult = await questionEngine.evaluateQuestionWithAI(q.prompt, q.type, q.options, { title: 'AI Engineer', company: 'Acme Inc' });
    console.log(`Q: "${q.prompt}" -> Answer: "${evalResult.answer}" (${evalResult.reasoning})`);
    if (q.prompt.includes('felony')) {
      assert.strictEqual(evalResult.answer.toLowerCase(), 'no', 'Conviction check must be No to prevent disqualification');
    } else {
      assert.strictEqual(evalResult.answer.toLowerCase(), 'yes', `Question "${q.prompt}" must be answered YES to prevent cancellation`);
    }
  }
  console.log('✓ TEST 1 PASSED: All qualification and screening questions answered affirmative YES to prevent job cancellation!\n');

  console.log('====================================================');
  console.log('🧪 TEST 2: AI Problem Resolution ("This is the problem, tell me how to resolve it")');
  console.log('====================================================');

  const resolvableObstacle = {
    jobTitle: 'Fullstack AI Engineer',
    company: 'NextGen AI',
    platform: 'LinkedIn',
    step: 2,
    error: 'Validation error: Please enter a valid number for Years of Experience in FastAPI',
    visibleErrors: ['Enter a whole number'],
    visibleInputs: [{ label: 'Years of Experience in FastAPI', type: 'number', value: '' }],
    visibleButtons: [{ text: 'Next', disabled: false }]
  };

  const resolutionResult = await groqAdvisor.consultProblemResolution(resolvableObstacle);
  console.log('AI Diagnosis:', resolutionResult.diagnosis);
  console.log('Can Resolve:', resolutionResult.canResolve);
  console.log('Resolution Plan Items:', resolutionResult.resolutionPlan?.length);
  assert.strictEqual(resolutionResult.canResolve, true, 'AI must be able to resolve valid input requirement');
  assert(resolutionResult.resolutionPlan.length > 0, 'AI must supply at least one concrete action');
  console.log('✓ TEST 2 PASSED: AI accurately diagnosed problem and provided executable resolution plan!\n');

  console.log('====================================================');
  console.log('🧪 TEST 3: When AI is Clueless -> Client Notification & Polite Cancellation');
  console.log('====================================================');

  const unresolvableObstacle = {
    jobTitle: 'Machine Learning Specialist',
    company: 'ClosedCorp',
    platform: 'LinkedIn',
    step: 1,
    error: 'Job posting has expired and is no longer accepting applications',
    visibleErrors: ['This position has closed and is no longer accepting applications'],
    visibleInputs: [],
    visibleButtons: []
  };

  const cluelessResult = await groqAdvisor.consultProblemResolution(unresolvableObstacle);
  console.log('AI canResolve:', cluelessResult.canResolve);
  console.log('AI clueless:', cluelessResult.clueless);
  console.log('AI cluelessReason:', cluelessResult.cluelessReason);
  assert.strictEqual(cluelessResult.canResolve, false, 'AI must flag closed/impossible job as unresolvable');
  assert.strictEqual(cluelessResult.clueless, true, 'AI must flag clueless/impossible condition');

  // Verify exact client cancellation message formatted by InternalAgentSystem
  const clientMsg = internalAgentSystem.formatClientMessage(cluelessResult.cluelessReason || unresolvableObstacle.error);
  console.log('Formatted Client Notification Message:\n->', clientMsg);

  assert(clientMsg.startsWith('Sir, this is the problem we are facing:'), 'Message must start with "Sir, this is the problem we are facing:"');
  assert(clientMsg.includes('So we are canceling the job apply, you please see another one.'), 'Message must conclude with "So we are canceling the job apply, you please see another one."');
  console.log('✓ TEST 3 PASSED: Exact client notification generated and formatted seamlessly!\n');

  console.log('====================================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
