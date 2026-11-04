require('../engine/envLoader');
const apiKey = process.env.GROQ_API_KEY;

async function testGroqQuestionAnswering() {
  const profile = {
    name: "Shoaib Akhtar",
    title: "Senior AI Architect / LLM Engineer",
    yearsOfExperience: 5,
    skills: ["Python", "PyTorch", "LangChain", "Multi-Agent Systems", "RAG", "Distributed Systems"],
    workAuthorization: "Requires H1B/Sponsorship or Remote Contract"
  };

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
          content: 'You are an autonomous application assistant. Answer unknown job application form fields accurately using ONLY the candidate profile. Keep text answers concise (1-2 sentences). Return JSON { "answer": string, "confidence": number, "explanation": string }.'
        },
        {
          role: 'user',
          content: `Candidate Profile: ${JSON.stringify(profile)}
          
Question on form: "Briefly describe your experience deploying multi-agent or LLM workflows in production."
Input type: textarea`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 200
    })
  });

  const data = await res.json();
  const duration = Date.now() - start;
  console.log(`⏱️ Groq answered question in ${duration}ms`);
  console.log('Result:', data.choices?.[0]?.message?.content);
}

testGroqQuestionAnswering().catch(console.error);
