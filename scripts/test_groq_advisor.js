require('../engine/envLoader');
const apiKey = process.env.GROQ_API_KEY;

async function testGroqAdvisor() {
  const start = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'system',
          content: 'You are an autonomous browser self-healing assistant for job applications. You diagnose obstacles (missing buttons, unrecognized questions, error banners) and determine the exact next step. Output strictly valid JSON with { "action": "click"|"fill"|"select"|"retry", "targetText": "string", "reasoning": "string" }.'
        },
        {
          role: 'user',
          content: 'The automation cannot find the "Submit" button on step 3. The page currently shows buttons: ["Back", "Save and Continue Later", "Review Your Information"]. What is the correct next step?'
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 250
    })
  });

  const data = await res.json();
  const duration = Date.now() - start;
  console.log(`⏱️ Groq completed in ${duration}ms`);
  console.log('Result:', data.choices?.[0]?.message?.content);
}

testGroqAdvisor().catch(console.error);
