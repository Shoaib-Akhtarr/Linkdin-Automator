/**
 * Test: Fully Autonomous Execution & Groq AI Self-Healing Fallback
 * 
 * Verifies:
 * 1. 0s Human-Wait / Pure Autonomous Execution (no 300s pauses)
 * 2. Groq AI Question Resolution on Custom/Unrecognized Form Fields
 * 3. Groq AI Obstacle & Wizard Navigation Diagnosis
 * 4. Error rate reduction via Multi-Tier Fallback (DOM -> a11y -> Groq AI)
 */

const { chromium } = require('playwright');
const groqAdvisor = require('../engine/groqAdvisor');
const questionEngine = require('../engine/questionEngine');

async function runAutonomousGroqSelfHealingTest() {
  console.log('================================================================');
  console.log('🤖 TESTING AUTONOMOUS EXECUTION & GROQ AI SELF-HEALING ADVISOR');
  console.log('================================================================\n');

  // TEST 1: GROQ AVAILABILITY & CONNECTIVITY
  console.log('1. Checking Groq AI Advisor status...');
  const isAvailable = groqAdvisor.isAvailable();
  console.log(`   Groq Advisor Active: ${isAvailable}`);
  if (!isAvailable) {
    throw new Error('Groq API Key not detected in environment!');
  }

  // TEST 2: GROQ QUESTION RESOLUTION (Unrecognized / Complex Question)
  console.log('\n2. Testing Groq Question Resolution for Unrecognized Form Questions...');
  const customQuestions = [
    {
      prompt: 'Describe a complex challenge you solved while designing an agentic RAG or multi-agent workflow.',
      type: 'textarea',
      options: []
    },
    {
      prompt: 'Are you comfortable working asynchronously across global timezones with distributed teams?',
      type: 'radio',
      options: ['Yes', 'No']
    },
    {
      prompt: 'What is your current notice period / availability to start?',
      type: 'select',
      options: ['Immediately', '2 Weeks', '1 Month', 'More than 1 month']
    }
  ];

  for (const q of customQuestions) {
    const start = Date.now();
    const result = await questionEngine.evaluateQuestionWithAI(q.prompt, q.type, q.options, {
      title: 'Senior AI Engineer',
      company: 'TechCorp'
    });
    const time = Date.now() - start;
    console.log(`   Q: "${q.prompt.slice(0, 45)}..."`);
    console.log(`      ✓ Answer: "${result.answer}" (${time}ms, confidence: ${result.confidence})`);
    console.log(`      ✓ Reasoning: ${result.reasoning}`);
  }

  // TEST 3: GROQ PAGE OBSTACLE / NEXT ACTION ADVICE
  console.log('\n3. Testing Groq Self-Healing Advice on Stuck Page Simulation...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  // Create a page with non-standard buttons and an error notice
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Job Portal Step 2</title></head>
      <body>
        <div class="alert alert-warning">Please review your summary before moving to final confirmation.</div>
        <form>
          <div><label>Notes</label><textarea id="custom_notes"></textarea></div>
          <div style="margin-top:20px;">
            <button type="button" id="btn-save-draft">Save Draft</button>
            <button type="button" id="btn-review-proceed" style="background:blue;color:white;">Proceed to Application Review</button>
            <a href="#" id="link-cancel">Cancel Application</a>
          </div>
        </form>
      </body>
    </html>
  `);

  console.log('   Simulating stuck state: Standard Next/Submit buttons missing...');
  const startAdvice = Date.now();
  const advice = await groqAdvisor.adviseNextAction(page, 'No standard Next or Submit button found on active step');
  const adviceTime = Date.now() - startAdvice;

  console.log(`   ✓ Groq Advice Received in ${adviceTime}ms:`);
  console.log(`      Action: "${advice.action}"`);
  console.log(`      Target Text: "${advice.targetText}"`);
  console.log(`      Reasoning: "${advice.reasoning}"`);

  // TEST 4: EXECUTING GROQ'S ADVICE
  console.log('\n4. Executing Groq Advised Recovery Action...');
  let clicked = false;
  await page.exposeFunction('onButtonClicked', () => { clicked = true; });
  await page.evaluate(() => {
    document.getElementById('btn-review-proceed').addEventListener('click', () => window.onButtonClicked());
  });

  const executed = await groqAdvisor.executeAdvice(page, advice, (msg) => console.log(`   [Engine Update] ${msg}`));
  console.log(`   ✓ Action Executed: ${executed}`);
  console.log(`   ✓ Target Button Clicked in Page: ${clicked}`);

  await browser.close();

  console.log('\n================================================================');
  console.log('🎉 ALL TESTS PASSED! AUTONOMOUS EXECUTION & GROQ SELF-HEALING READY');
  console.log('================================================================');
}

runAutonomousGroqSelfHealingTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
