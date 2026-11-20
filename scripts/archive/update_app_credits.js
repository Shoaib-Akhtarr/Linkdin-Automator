const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(file, 'utf8');

const regex = /(eventSource\.addEventListener\('stats_update',\s*e\s*=>\s*\{[\s\S]*?loadHistory\(\);)(\s*\n\s*\}\);)/;
if (regex.test(content)) {
  content = content.replace(regex, '$1\n    fetchAndUpdateCredits();$2');
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully hooked fetchAndUpdateCredits to stats_update event!');
} else {
  console.log('Pattern not matched');
}
