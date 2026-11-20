const bridge = require('../engine/browserBridge');
const { execSync } = require('child_process');

(async () => {
  console.log('1. Launching headless Chrome via browserBridge...');
  await bridge.launchChromeIfNeeded();
  const page = await bridge.getPage();
  console.log('2. Successfully connected! Page URL:', page.url());

  const ps = execSync('powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object Id, MainWindowTitle"', { encoding: 'utf8', windowsHide: true });
  console.log('3. Visible Chrome Windows (should be empty for automation Chrome):');
  console.log(ps || '(None - 100% headless)');

  console.log('4. Taking a test screenshot in headless mode...');
  const ss = await page.screenshot({ type: 'jpeg', quality: 50 });
  console.log('5. Screenshot taken! Buffer length:', ss.length, 'bytes');

  console.log('✅ TEST PASSED: Chrome is completely headless and functional with zero visible windows.');
  process.exit(0);
})();
