const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// 1. Add tab button
if (!html.includes('data-tab="tab-vault"')) {
  const oldTabBtn = `<button class="tab-btn py-3 border-b-2 border-transparent text-steel hover:text-fog cursor-pointer transition" data-tab="tab-history">\r\n      04 // APPLICATION LOGS\r\n    </button>`;
  const newTabBtns = `<button class="tab-btn py-3 border-b-2 border-transparent text-steel hover:text-fog cursor-pointer transition" data-tab="tab-history">\r\n      04 // APPLICATION LOGS\r\n    </button>\r\n    <button class="tab-btn py-3 border-b-2 border-transparent text-steel hover:text-fog cursor-pointer transition" data-tab="tab-vault">\r\n      05 // CREDENTIALS &amp; VAULT\r\n    </button>`;
  
  if (html.includes(oldTabBtn)) {
    html = html.replace(oldTabBtn, newTabBtns);
  } else {
    // Try with \n
    html = html.replace(
      /data-tab="tab-history"[\s\S]*?<\/button>/,
      match => `${match}\n    <button class="tab-btn py-3 border-b-2 border-transparent text-steel hover:text-fog cursor-pointer transition" data-tab="tab-vault">\n      05 // CREDENTIALS &amp; VAULT\n    </button>`
    );
  }
}

// 2. Add tab-vault section
const vaultSectionHtml = `
    <!-- TAB 5: UNIVERSAL PLATFORM CREDENTIALS & VAULT -->
    <section id="tab-vault" class="tab-content hidden space-y-6">
      <div class="bg-carbon border border-iron rounded-[2px] p-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-iron pb-4 mb-6 gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-ember font-bold text-xs">🔒 VAULT //</span>
              <h2 class="text-sm font-bold text-paper uppercase tracking-wider">Universal Platform Credentials &amp; First-Time Setup</h2>
            </div>
            <p class="text-xs text-ash mt-1">AES-256 DPAPI hardware-isolated storage for all platform accounts, scaleup portals, and automation engines.</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="btnRefreshVault" class="px-3 py-1.5 rounded-[2px] bg-void hover:bg-carbon text-xs font-semibold text-paper border border-iron transition cursor-pointer flex items-center gap-1.5">
              <span>↻ Reload Vault</span>
            </button>
          </div>
        </div>

        <!-- First-Time Setup Banner -->
        <div class="p-4 bg-void border border-iron rounded-[2px] mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="space-y-1">
            <span class="text-[10px] text-ember uppercase tracking-wider font-bold">First-Time Setup Guide</span>
            <p class="text-xs text-paper">
              Credentials are encrypted using Windows DPAPI machine keys. When running in CDP or Headless mode, the engine uses these credentials or your existing Chrome sessions to apply autonomously without human intervention.
            </p>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-steel">Status:</span>
            <span id="vaultOverallStatus" class="px-2 py-0.5 rounded-[2px] bg-carbon text-paper border border-iron font-bold text-[11px]">LOADING...</span>
          </div>
        </div>

        <!-- Cards Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

          <!-- 1. OTTA CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-otta">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-otta"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">Otta (Welcome to the Jungle)</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-otta">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Curated high-growth tech &amp; AI scaleup applications.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Email / Username</label>
                  <input type="text" id="vault-otta-email" placeholder="user@domain.com" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Password</label>
                  <input type="password" id="vault-otta-pass" placeholder="••••••••" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">API Key / Token (Optional)</label>
                  <input type="text" id="vault-otta-api" placeholder="Optional bearer/API token" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('otta')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('otta')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Verify Session
                </button>
              </div>
              <div id="verify-msg-otta" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

          <!-- 2. LINKEDIN CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-linkedin">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-linkedin"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">LinkedIn</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-linkedin">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Easy Apply, search crawling, and hiring manager outreach.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Email / Phone</label>
                  <input type="text" id="vault-linkedin-email" placeholder="onlyshoaib158@gmail.com" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Password (Optional if Chrome Logged In)</label>
                  <input type="password" id="vault-linkedin-pass" placeholder="••••••••" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div class="text-[10px] text-steel bg-carbon p-2 rounded-[2px] border border-iron">
                  💡 Uses active Chrome profile session automatically.
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('linkedin')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('linkedin')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Check Session
                </button>
              </div>
              <div id="verify-msg-linkedin" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

          <!-- 3. WELLFOUND CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-wellfound">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-wellfound"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">Wellfound (AngelList)</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-wellfound">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Startup job matches, founder notes, and direct applications.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Email</label>
                  <input type="text" id="vault-wellfound-email" placeholder="user@domain.com" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Password</label>
                  <input type="password" id="vault-wellfound-pass" placeholder="••••••••" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('wellfound')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('wellfound')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Verify
                </button>
              </div>
              <div id="verify-msg-wellfound" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

          <!-- 4. Y COMBINATOR CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-ycombinator">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-ycombinator"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">Y Combinator (WAAS)</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-ycombinator">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Work at a Startup — direct YC founder outreach.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Hacker News / WAAS Email</label>
                  <input type="text" id="vault-ycombinator-email" placeholder="user@domain.com" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Password</label>
                  <input type="password" id="vault-ycombinator-pass" placeholder="••••••••" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('ycombinator')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('ycombinator')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Verify
                </button>
              </div>
              <div id="verify-msg-ycombinator" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

          <!-- 5. GMAIL & IMAP CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-email">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-email"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">Gmail &amp; IMAP Scanner</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-email">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Parses interview requests &amp; auto-detects quota-full ghost jobs.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Gmail Address</label>
                  <input type="text" id="vault-email-email" placeholder="onlyshoaib158@gmail.com" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Gmail App Password (16-chars)</label>
                  <input type="password" id="vault-email-pass" placeholder="zaan xbxu lise cqoa" class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('email')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('email')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Test IMAP
                </button>
              </div>
              <div id="verify-msg-email" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

          <!-- 6. GROQ AI CARD -->
          <div class="bg-void border border-iron rounded-[2px] p-4 flex flex-col justify-between space-y-4" id="card-groq">
            <div class="space-y-3">
              <div class="flex items-center justify-between border-b border-iron pb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-steel" id="status-dot-groq"></span>
                  <h3 class="text-xs font-bold text-paper uppercase">Groq AI (Self-Healing)</h3>
                </div>
                <span class="text-[10px] text-steel" id="status-badge-groq">CHECKING...</span>
              </div>
              <p class="text-[11px] text-ash">Autonomous question answers, stuck wizards &amp; ghost filter NLP.</p>
              
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] text-steel uppercase block mb-1">Groq API Key</label>
                  <input type="password" id="vault-groq-api" placeholder="gsk_..." class="w-full bg-carbon border border-iron text-paper text-xs px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-ember">
                </div>
                <div class="text-[10px] text-steel bg-carbon p-2 rounded-[2px] border border-iron">
                  ⚡ Model: <strong class="text-paper">qwen/qwen3.8-27b</strong> (verified active)
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-iron">
              <div class="flex gap-2">
                <button onclick="savePlatformCreds('groq')" class="flex-1 py-1.5 bg-carbon hover:bg-iron text-xs font-bold text-paper border border-iron rounded-[2px] transition cursor-pointer">
                  Save
                </button>
                <button onclick="verifyPlatformCreds('groq')" class="flex-1 py-1.5 bg-void hover:bg-carbon text-xs font-semibold text-ember border border-ember rounded-[2px] transition cursor-pointer">
                  Test API
                </button>
              </div>
              <div id="verify-msg-groq" class="text-[10px] text-steel truncate"></div>
            </div>
          </div>

        </div>
      </div>
    </section>
`;

if (!html.includes('id="tab-vault"')) {
  html = html.replace('</main>', `${vaultSectionHtml}\n  </main>`);
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('✅ Added tab-vault section to public/index.html');
} else {
  console.log('tab-vault section already present in public/index.html');
}
