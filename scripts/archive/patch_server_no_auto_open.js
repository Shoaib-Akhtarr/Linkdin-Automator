const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  'exec(`start http://localhost:${PORT}`, { windowsHide: true });',
  "if (process.env.OPEN_BROWSER === 'true') { exec(`start http://localhost:${PORT}`, { windowsHide: true }); }"
);

fs.writeFileSync('server.js', code, 'utf8');
console.log('✅ Patched server.js browser auto-open condition');
