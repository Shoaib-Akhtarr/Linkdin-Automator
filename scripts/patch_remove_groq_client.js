const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'public', 'app.js');
let js = fs.readFileSync(appPath, 'utf8');

js = js.replace(
  "const platforms = ['otta', 'linkedin', 'wellfound', 'ycombinator', 'email', 'groq'];",
  "const platforms = ['otta', 'linkedin', 'wellfound', 'ycombinator', 'email'];"
);

fs.writeFileSync(appPath, js, 'utf8');
console.log('✅ Removed groq from platforms list in public/app.js');
