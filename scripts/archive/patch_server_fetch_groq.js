const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

const target = `    if (platform === 'groq') {
      const Groq = require('groq-sdk');
      const groqKey = creds?.apiKey || process.env.GROQ_API_KEY;
      if (!groqKey) return res.json({ success: false, message: 'No Groq API key set.' });
      const groq = new Groq({ apiKey: groqKey });
      const models = await groq.models.list();
      return res.json({ success: true, message: \`Groq connected! (\${models.data?.length || 0} models available)\` });
    }`;

const replacement = `    if (platform === 'groq') {
      const groqKey = creds?.apiKey || process.env.GROQ_API_KEY;
      if (!groqKey) return res.json({ success: false, message: 'No Groq API key set.' });
      const resModels = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': \`Bearer \${groqKey}\` }
      });
      if (!resModels.ok) return res.json({ success: false, message: \`Groq API check failed: HTTP \${resModels.status}\` });
      const data = await resModels.json();
      return res.json({ success: true, message: \`Groq connected! (\${data.data?.length || 0} models available)\` });
    }`;

const crlfTarget = target.replace(/\n/g, '\r\n');
const crlfReplacement = replacement.replace(/\n/g, '\r\n');

if (code.includes(crlfTarget)) {
  code = code.replace(crlfTarget, crlfReplacement);
  fs.writeFileSync(serverPath, code, 'utf8');
  console.log('✅ Patched server.js to use native fetch for Groq (CRLF)');
} else if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(serverPath, code, 'utf8');
  console.log('✅ Patched server.js to use native fetch for Groq (LF)');
} else {
  console.log('Target not found in server.js');
}
