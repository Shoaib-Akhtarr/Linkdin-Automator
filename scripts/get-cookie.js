const { chromium } = require('playwright');

async function extractCookie() {
  console.log('Connecting to Chrome on port 9222 to read LinkedIn session...');
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      console.error('❌ No active browser contexts found in Chrome.');
      process.exit(1);
    }

    const cookies = await contexts[0].cookies(['https://www.linkedin.com']);
    const liAt = cookies.find(c => c.name === 'li_at');

    if (!liAt || !liAt.value) {
      console.error('❌ Could not find "li_at" cookie. Make sure you are logged in to LinkedIn in Chrome!');
      process.exit(1);
    }

    console.log('\n======================================================');
    console.log('✅ SUCCESS! Your LinkedIn Session Cookie (li_at) Found:');
    console.log('======================================================\n');
    console.log(liAt.value);
    console.log('\n======================================================');
    console.log('📋 HOW TO ADD THIS TO GITHUB:');
    console.log('1. Go to your repository on GitHub:');
    console.log('   https://github.com/Shoaib-Akhtarr/Linkdin-Automator/settings/secrets/actions');
    console.log('2. Click the green "New repository secret" button.');
    console.log('3. Name: LI_AT_COOKIE');
    console.log('4. Secret: Paste the exact string above.');
    console.log('5. Click "Add secret".');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Error reading cookie from Chrome:', err.message);
  }
}

extractCookie();
