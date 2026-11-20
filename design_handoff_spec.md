# Axiom Engine — Developer Handoff & Component Specification
> Design System, Token Architecture & UI Engineering Specifications  
> **Theme:** Dark Terminal Engine (Axiom) | **Universal Typography:** BerkeleyMono / JetBrains Mono | **Accent:** Ember (`#da5c2c`)

---

## 1. Executive Summary & Architectural Principles

This document serves as the formal developer handoff specification for **Axiom** (`public/index.html`), implementing the findings from the Impeccable Design Audit and adhering strictly to `design.md`.

### Core Engineering Directives:
1. **Midnight Flat Canvas**: Every surface is pure flat neutral dark—`#000000` Void canvas, `#111111` Carbon containers, `#191919` Graphite active elements, separated by crisp `1px solid #202020` Iron hairline borders.
2. **Zero Gradients & Zero Heavy Drop-Shadows**: Gradients (such as `bg-gradient-to-r` in `#aiConsensusCard`) and diffuse drop shadows (`shadow-sm`, `shadow-lg`, `shadow-2xl`) are strictly banned. Elevation is expressed through subtle neutral contrast and 1px borders.
3. **Strict 2px Geometric Grid**: All containers, cards, inputs, buttons, and modals use `rounded-[2px]`. The only exception is `9999px` for pill tags under 32px height and pulse indicator dots.
4. **Single Chromatic Accent**: Ember (`#da5c2c`) carries all chromatic focus (primary CTAs, active tab border indicators, 2px left-border accents, focused inputs, and the blinking cursor). Rogue ambers, greens, and blues are eliminated or converted to disciplined functional tones.
5. **No Decorative Consumer Emojis**: Replace consumer emoji (`⚡`, `📄`, `✉`, `📌`, `🛠️`, `🎯`, `🔒`, `🌐`, `🤖`, `🚀`, `👤`) with sharp monospaced terminal glyphs (e.g. `[>]`, `[+]`, `[x]`, `[!]`, `[$]`, `[@]`) or clean 14px SVG stroke icons.
6. **Eliminate Cards-Within-Cards**: Flatten nested containers into clean sections separated by hairline dividers (`border-t border-iron`) and rhythmic padding rather than boxed-in enclosures.
7. **DOM Integrity Guarantee**: All existing IDs, class hooks, `data-tab` attributes, and event handlers used by `public/app.js` are preserved 100%.

---

## 2. Design Tokens System

### 2.1 Color Tokens

| Token Name | Hex Code | Role & Usage | Tailwind Class |
|------------|----------|--------------|----------------|
| **Void** | `#000000` | Page background, input backgrounds, terminal log surfaces | `bg-void` / `text-void` |
| **Carbon** | `#111111` | Primary container surfaces, card bases, toolbar panels | `bg-carbon` / `text-carbon` |
| **Graphite** | `#191919` | Elevated card surfaces, active list items, hover states | `bg-graphite` |
| **Iron** | `#202020` | Standard hairline borders, dividers, subtle separators | `border-iron` |
| **Slate** | `#3a3a3a` | Muted borders, secondary outlines, interactive hover borders | `border-slate` |
| **Pewter** | `#505050` | Decorative rules, inactive borders | `border-pewter` |
| **Steel** | `#606060` | Inactive labels, tertiary metadata, unselected glyphs | `text-steel` |
| **Ash** | `#7e7e7e` | Muted timestamps, tertiary annotations (>=12px only) | `text-ash` |
| **Fog** | `#b4b4b4` | Secondary text, descriptions, body text, form labels | `text-fog` |
| **Chalk** | `#d9d9d9` | High-contrast subheadings, crisp UI labels | `text-chalk` |
| **Paper** | `#eeeeee` | Primary text, active titles, button text, hero headers | `text-paper` |
| **Ember** | `#da5c2c` | Primary CTA fill, active border accent, focus rings, cursor | `bg-ember` / `text-ember` / `border-ember` |
| **Ember Hover**| `#e56939` | Hover state for primary CTAs | `hover:bg-ember-hover` |
| **Ember Muted**| `rgba(218,92,44,0.15)`| Active list item background, subtle badge background | `bg-ember/15` |
| **Ember Dark** | `#a8421b` | Active press state for buttons | `active:bg-ember-dark` |

#### Semantic Status Tokens (Disciplined Functional Muted Tones)
| Status | Text Token | Background Token | Border Token | Usage |
|--------|------------|------------------|--------------|-------|
| **Active / Online** | `#22c55e` | `rgba(34,197,94,0.12)` | `rgba(34,197,94,0.30)` | Connected sessions, running engine, verified platforms |
| **Review / Warning** | `#da5c2c` (Ember) | `rgba(218,92,44,0.15)` | `rgba(218,92,44,0.40)` | Human review required, 2FA prompt, attention items |
| **Error / Alert** | `#f43f5e` | `rgba(244,63,94,0.12)` | `rgba(244,63,94,0.30)` | Failed applications, disconnected sessions, stop buttons |
| **Idle / Neutral** | `#606060` (Steel) | `#111111` (Carbon) | `#202020` (Iron) | Idle engine status, pending checks |

---

### 2.2 Typography Scale

- **Primary Font Family**: `JetBrains Mono`, `BerkeleyMono`, `monospace`
- **Secondary Font Family (Job Descriptions Only)**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Letter Spacing**: `-0.01em` across all mono text

| Role | Font Size | Line Height | Font Weight | Letter Spacing | Target Element |
|------|-----------|-------------|-------------|----------------|----------------|
| **Micro / Tag** | 10px (`text-[10px]`) | 1.4 | 600 (`font-semibold`) | 0.04em uppercase | Badges, status chips, metadata timestamps |
| **Caption / Label** | 11px (`text-[11px]`) | 1.5 | 500 / 600 | 0.02em uppercase | Field labels, sub-bar items, platform labels |
| **UI Body / Small** | 12px (`text-xs`) | 1.5 | 400 (`font-normal`) | 0 | Standard UI text, table cells, form inputs |
| **Body / Regular** | 13px–14px (`text-sm`)| 1.6 | 400 (`font-normal`) | -0.01em | Role descriptions, summaries, logs |
| **Subheading** | 14px (`text-sm`) | 1.4 | 700 (`font-bold`) | 0.02em uppercase | Section titles, card headers, modal headers |
| **Heading** | 16px–18px (`text-base`)| 1.3 | 700 (`font-bold`) | 0 | Job titles, metric callouts, wizard step titles |
| **Display / Metric** | 24px–30px (`text-2xl`)| 1.2 | 700 / 800 (`font-bold`)| -0.02em | Stat numbers, score indicators |

---

### 2.3 Spacing & Layout Tokens

- **Grid Base**: 4px / 8px scale
- **Horizontal Content Container**: `max-w-7xl w-full mx-auto px-4 sm:px-6`
- **Component Padding**:
  - Cards: `p-4` or `p-5`
  - Inputs: `px-3 py-2` (compact: `px-2.5 py-1.5`)
  - Primary Buttons: `px-4 py-2` (compact: `px-3 py-1.5`)
  - Table Cells: `py-2.5 px-3`
  - Badges / Pills: `px-2 py-0.5`
- **Separation Dividers**: `border-iron` (`1px solid #202020`)
- **Accented Left Border**: `border-l-2 border-l-ember` (Active inspection, Current Job card, Review banner)

---

## 3. Component Specifications & Markup Guides

### 3.1 Global Header (`<header>`)
- **Container**: `sticky top-0 z-50 border-b border-iron bg-void px-6 py-2.5 flex items-center justify-between`
- **Brand Cluster**:
  - Terminal Glyph: `w-8 h-8 rounded-[2px] bg-carbon border border-iron flex items-center justify-center font-bold text-xs text-ember select-none` with content `>_`
  - Title Group: `text-xs font-bold text-paper tracking-wider uppercase flex items-center gap-1.5`
  - Cursor: `span.cursor-blink.text-ember.font-bold` containing `_`
  - Engine Version Pill: `text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] bg-carbon text-steel border border-iron` containing `CDP v2.4`
- **Control Cluster (Right Side)**:
  - **Platform Select**: `#headerPlatformSelect` inside `bg-carbon border border-iron rounded-[2px] px-2.5 py-1`. Select input: `bg-void border border-iron text-paper text-xs font-medium rounded-[2px] px-2 py-1 focus:border-ember focus:outline-none`.
  - **Status Badge**: `#statusBadge` with child `#statusText`. Default class: `flex items-center gap-2 px-3 py-1 rounded-[2px] border border-iron bg-carbon text-xs font-bold uppercase tracking-wider text-steel`.
  - **Credit Badge**: `#creditBadgeBtn` with child `#creditBadgeText`. Styled with Ember/Paper theme instead of rogue amber: `flex items-center gap-1.5 px-3 py-1 rounded-[2px] bg-carbon border border-ember/40 text-paper text-xs font-bold uppercase tracking-wider hover:bg-graphite hover:border-ember transition cursor-pointer`.
  - **Setup Wizard Trigger**: `#btnOpenSetupWizard`: `px-3 py-1 rounded-[2px] bg-carbon hover:bg-graphite border border-iron hover:border-ember text-fog hover:text-paper text-xs font-bold uppercase tracking-wider transition flex items-center gap-1.5 cursor-pointer`.
  - **Start Button**: `#btnStart`: `px-4 py-1.5 rounded-[2px] bg-ember hover:bg-ember-hover text-paper text-xs font-bold uppercase tracking-wider transition flex items-center gap-1.5 cursor-pointer`.
  - **Pause Button**: `#btnPause`: `px-4 py-1.5 rounded-[2px] bg-carbon hover:bg-graphite border border-slate text-paper text-xs font-bold uppercase tracking-wider transition flex items-center gap-1.5 hidden cursor-pointer`.
  - **Stop Button**: `#btnStop`: `px-4 py-1.5 rounded-[2px] bg-carbon hover:bg-graphite border border-rose-900/60 text-rose-400 text-xs font-bold uppercase tracking-wider transition flex items-center gap-1.5 hidden cursor-pointer`.

---

### 3.2 Human Review Alert Banner (`#reviewBanner`)
- **Container**: `bg-graphite border-y border-iron border-l-2 border-l-ember px-6 py-2.5 flex items-center justify-between hidden`
- **Left Column**:
  - Alert Glyph Box: `w-7 h-7 rounded-[2px] bg-carbon border border-ember/40 text-ember flex items-center justify-center font-bold text-xs` with `!`
  - Alert Label: `text-[11px] font-bold text-paper uppercase tracking-wider` with `[HUMAN_REVIEW_REQUIRED]`
  - Review Job Title: `#reviewJobTitle` styled with `text-xs text-fog`
- **Right Column (Action Pair)**:
  - Skip Button: `#btnSkipReview` (`px-3 py-1 rounded-[2px] border border-iron bg-carbon hover:bg-graphite text-xs font-medium text-fog hover:text-paper transition cursor-pointer`)
  - Approve Button: `#btnApproveReview` (`px-4 py-1 rounded-[2px] bg-ember hover:bg-ember-hover text-xs font-bold text-paper transition cursor-pointer flex items-center gap-1`)

---

### 3.3 Main Navigation Tab System (`.tab-btn`)
- **Container**: `border-b border-iron bg-carbon px-6 flex space-x-6 text-xs font-medium overflow-x-auto`
- **Tab Buttons**:
  - Tab 1: `button.tab-btn[data-tab="tab-direct-jobs"]` -> Text: `[01] DIRECT ATS` (with green pulse dot: `w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1`)
  - Tab 2: `button.tab-btn[data-tab="tab-dashboard"]` -> Text: `[02] TELEMETRY`
  - Tab 3: `button.tab-btn[data-tab="tab-profile"]` -> Text: `[03] PROFILE & CV`
  - Tab 4: `button.tab-btn[data-tab="tab-settings"]` -> Text: `[04] SEARCH & RULES`
  - Tab 5: `button.tab-btn[data-tab="tab-history"]` -> Text: `[05] APPLICATION LOGS`
  - Tab 6: `button.tab-btn[data-tab="tab-vault"]` -> Text: `[06] CREDENTIALS & VAULT`
- **Active State Class**: `py-2.5 border-b-2 border-ember text-paper font-bold cursor-pointer transition flex items-center`
- **Inactive State Class**: `py-2.5 border-b-2 border-transparent text-steel hover:text-fog cursor-pointer transition flex items-center`

---

### 3.4 Active Search Target Ribbon
- **Container**: `bg-void border-b border-iron px-6 py-2 flex items-center justify-between text-xs text-steel`
- **Telemetry Readout**:
  - `> TARGET:` `<strong id="barPlatform" class="text-paper font-semibold">ALL PLATFORMS</strong>`
  - `| LOC:` `<strong id="barLocation" class="text-paper font-semibold">WORLDWIDE</strong>`
  - `| WORKPLACE:` `<strong id="barWorkplace" class="text-paper font-semibold">REMOTE</strong>`
  - `| MODE:` `<strong id="barMode" class="text-paper font-semibold">HYBRID</strong>`
  - `| SCOPE:` `<strong id="barApplyType" class="text-fog font-medium">ALL JOBS (EASY APPLY + ATS)</strong>`

---

### 3.5 Tab 1: Direct ATS Jobs & 1-Click Apply (Master-Detail Architecture)

#### Top Filter & Action Bar
- Search Input: `#atsSearchInput` (`bg-void border border-iron rounded-[2px] px-3 py-1.5 text-xs text-paper placeholder-steel w-52 sm:w-64 focus:outline-none focus:border-ember`)
- Filter Segmented Control: Container `flex items-center border border-iron rounded-[2px] overflow-hidden text-xs`. Buttons `.ats-filter-btn[data-filter="..."]` (`all`, `ashby`, `greenhouse`, `lever`, `applied`). Active button has `bg-void text-paper font-bold`; inactive button has `bg-carbon text-steel hover:text-fog`.
- Scan Button: `#btnRefreshAtsJobs` with child `#btnRefreshAtsJobsText` (`px-3 py-1.5 rounded-[2px] bg-void hover:bg-graphite border border-iron text-fog hover:text-paper text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer`).
- Total Badge: `#atsJobTotalBadge` (`px-2 py-0.5 rounded-[2px] bg-ember/15 text-ember border border-ember/30 text-[11px] font-bold`).

#### Left Pane: Jobs Listing (`lg:col-span-5`)
- Container: `bg-carbon border border-iron rounded-[2px] p-3 flex flex-col h-[calc(100vh-230px)] min-h-[620px]`
- List Header: `flex items-center justify-between pb-2 border-b border-iron text-[11px] text-steel font-mono uppercase` with `#atsListCount`
- Scroll Area: `#atsJobsList` (`flex-1 overflow-y-auto space-y-2 mt-2 pr-1`)
- Dynamic Job Card Template (`.ats-job-card`):
  - Inactive: `bg-void hover:bg-graphite border border-iron hover:border-slate p-3 rounded-[2px] cursor-pointer transition flex flex-col justify-between`
  - Selected: `bg-graphite border-l-2 border-l-ember border-t border-r border-b border-iron p-3 rounded-[2px] cursor-pointer transition flex flex-col justify-between`

#### Right Pane: Professional Job Inspector (`lg:col-span-7`)
- Container: `bg-carbon border border-iron rounded-[2px] p-5 flex flex-col h-[calc(100vh-230px)] min-h-[620px] overflow-hidden`
- Empty State: `#atsEmptyInspector` (`flex-1 flex flex-col items-center justify-center text-center p-8 text-steel`)
- Active State: `#atsActiveInspector` (`hidden flex-1 flex flex-col overflow-hidden`)
- Sticky Header:
  - Platform Badge `#inspPlatformBadge` (`px-2 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider bg-void border border-iron text-steel`)
  - Status Badge `#inspStatusBadge` (`px-2 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider bg-ember/20 text-ember border border-ember/30`)
  - Job Title `#inspJobTitle` (`text-base font-bold text-paper mt-1`)
  - Company & Location `#inspCompany`, `#inspLocation` (`text-xs text-steel mt-0.5 flex items-center gap-2`)
  - Portal Link `#inspExternalLink` (`px-3 py-1.5 rounded-[2px] bg-void hover:bg-graphite border border-iron text-fog hover:text-paper text-xs font-semibold flex items-center gap-1 transition`)
  - Primary Apply Button `#btnInspApply` with `#inspApplyText` (`px-5 py-2 rounded-[2px] bg-ember hover:bg-ember-hover text-paper text-xs font-bold uppercase tracking-wider transition flex items-center gap-2 cursor-pointer`)
- **3-AI Consensus Card (`#aiConsensusCard`)**:
  - Flat Surface: `bg-void border border-iron rounded-[2px] p-3 space-y-3` (Eliminate gradients!)
  - Consensus Header: `#aiScoreCircle` (`w-11 h-11 rounded-[2px] bg-ember/15 border border-ember text-ember font-bold text-sm flex flex-col items-center justify-center shrink-0`), score text `#aiConsensusScore`, verdict badge `#aiVerdictBadge`, explanation `#aiVerdictText`, re-analyze button `#btnReanalyzeAi` with `#btnReanalyzeAiText`.
  - 3-Model Mini Cards Grid (`grid grid-cols-1 md:grid-cols-3 gap-2 text-xs`):
    - Model 1 (Qwen 27B): `#qwenScoreBadge`, `#qwenVerdict`, `#qwenReason`
    - Model 2 (GPT OSS 20B): `#gpt20ScoreBadge`, `#gpt20Verdict`, `#gpt20Reason`
    - Model 3 (GPT OSS 120B): `#gpt120ScoreBadge`, `#gpt120Verdict`, `#gpt120Reason`
- **Step 2: 24h Cold Outreach Note**:
  - Tabs `#btnTabOutreachEM` and `#btnTabOutreachFounder`
  - Note Container `#outreachNoteText`
  - Copy Button `#btnCopyOutreachNote` with `#copyNoteBtnText`
  - Social Search Buttons `#btnSearchLinkedIn` and `#btnSearchTwitter`
- **Candidate Profile Compatibility Chip**:
  - Target Title `#cvTailoredTargetTitle`
  - Status Chip `#cvTailorStatusChip`
- **Job Description Section**:
  - Skill count badge `#jdSkillCountBadge`
  - Role Overview text `#jdOverviewText`
  - Tech stack chip container `#jdTechStackChips`
  - Bullet highlights container `#jdBulletsContainer` with list `#jdBulletsList`
  - Expand/collapse toggle `#btnToggleFullJd`
  - Formatted Description Box `#inspJobDesc`: `mt-2 text-fog leading-relaxed min-h-[220px] max-h-[380px] overflow-y-auto border-t border-iron pt-2`

---

### 3.6 Tab 2: Dashboard & Telemetry
- **Metrics Grid (`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4`)**:
  - Applied Today Card: `#metricToday`, `#metricLimit`, Progress Bar `#metricProgressBar`
  - Safe Quota Remaining Card: `#metricRemaining`
  - Total Submissions Card: `#metricTotal`
  - Filtered / Skipped Card: `#metricSkipped`
  - All cards styled with `bg-carbon border border-iron rounded-[2px] p-4`.
- **Platform Telemetry Strip**:
  - Counters: `#statPlatLinkedIn`, `#statPlatWellfound`, `#statPlatYC`, `#statPlatOtta`, `#statPlatWWR`, `#statPlatRemoteOK`, `#statPlatJobicy`, `#statPlatRemoteAts`
- **Current Job In Progress Card (`#currentJobCard`)**:
  - `bg-carbon border border-iron border-l-2 border-l-ember rounded-[2px] p-4 hidden`
  - Elements: `#currentJobTitle`, `#currentJobDetails`
- **Split Telemetry Panel**:
  - Live Browser Preview: `#liveScreenshot`, `#liveScreenshotPlaceholder`
  - Terminal Logs: Stream container `#logContainer` with clear button `#btnClearLogs`

---

### 3.7 Tab 3: Profile & Screening Q&A
- **Action Header**: View resume button `#btnViewCurrentResume`, Save button `#btnSaveProfile`.
- **Resume Upload Dropzone**: `#tabResumeFileInput`, status badge `#tabResumeStatusBadge`.
- **Form Fields (Preserve IDs)**:
  - Personal: `#profFullName`, `#profEmail`, `#profPhone`, `#profCity`, `#profCountry`
  - Work Auth: `#profAuthorized`, `#profSponsorship`
  - Comp & Availability: `#profSalaryNumeric`, `#profNoticeWeeks`
  - Social Links: `#profLinkedin`, `#profGithub`
  - Skill Matrix: `#btnAddSkill`, container `#skillsTable` with `.skill-input`

---

### 3.8 Tab 4: Search & Filters (Settings)
- **Engine Directives (Preserve IDs)**:
  - Chrome Profile: `#setChromeProfile`, Headless Mode: `#setHeadlessMode`
  - Platform: `#setPlatform`, Execution Mode: `#setMode`, Scope: `#setApplyType`
  - Limit: `#setDailyLimit`, Date Posted: `#setDatePosted`
  - Keywords: `#setKeywords`, Preset Pills: `.kw-preset-pill`
  - Location: `#setLocation`, Location Pills: `.loc-pill`
  - Workplace: `#setWorkplaceType`, Blacklist: `#setBlacklist`
  - Intellisense Toggles: `#setIntelliReadJD`, `#setIntelliClearance`, `#setIntelliCitizenship`, `#setIntelliDynamicCV`
  - Save Button: `#btnSaveSettings`

---

### 3.9 Tab 5: Application Logs (History)
- **Controls**: Export CSV `#btnExportCsv`, Platform Filter Pills `.plat-filter-btn[data-platform="..."]`.
- **Telemetry Table**: Body `#historyTableBody`.

---

### 3.10 Tab 6: Universal Platform Credentials & Vault
- **Master Status**: `#vaultOverallStatus`, Reload button `#btnRefreshVault`.
- **Platform Accounts Grid**:
  - Otta: `#card-otta`, `#vault-otta-email`, `#vault-otta-pass`, `#vault-otta-api`, `#status-dot-otta`, `#status-badge-otta`, `#verify-msg-otta`
  - LinkedIn: `#card-linkedin`, `#vault-linkedin-email`, `#vault-linkedin-pass`, `#btnAutoLoginLinkedin`, `#status-dot-linkedin`, `#status-badge-linkedin`, `#verify-msg-linkedin`
  - Wellfound: `#card-wellfound`, `#vault-wellfound-email`, `#vault-wellfound-pass`, `#status-dot-wellfound`, `#status-badge-wellfound`, `#verify-msg-wellfound`
  - Y Combinator: `#card-ycombinator`, `#vault-ycombinator-email`, `#vault-ycombinator-pass`, `#status-dot-ycombinator`, `#status-badge-ycombinator`, `#verify-msg-ycombinator`
  - Email Scanner: `#card-email`, `#vault-email-email`, `#vault-email-pass`, `#status-dot-email`, `#status-badge-email`, `#verify-msg-email`

---

### 3.11 Modals System

#### A. First-Time Setup Wizard (`#setupWizardModal`)
- Backdrop: `fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 hidden`
- Window: `bg-carbon border border-iron rounded-[2px] max-w-3xl w-full max-h-[92vh] flex flex-col font-mono` (NO drop-shadows)
- Close Button: `#btnCloseWizard`
- Step Tabs: `#stepTab1`, `#stepTab2`, `#stepTab3`, `#stepTab4` (`.wizard-step-tab`)
- Step Contents: `#stepContent1`, `#stepContent2`, `#stepContent3`, `#stepContent4` (`.wizard-step-content`)
- Step 1 Elements: `#wizProfilesList`, `#wizHeadlessToggle`, `#btnWizStep1Next`
- Step 2 Elements: `#wizDropzone`, `#wizFileInput`, `#wizUploadStatus`, `#wizFullName`, `#wizEmail`, `#wizPhone`, `#wizLocation`, `#wizLinkedin`, `#wizGithub`, `#wizAuthorized`, `#wizSponsorship`, `#btnWizStep2Back`, `#btnWizStep2Next`
- Step 3 Elements: `#wizKeywordsCount`, `#btnGenerateGroqTitles`, `#wizKeywordInput`, `#btnWizAddKeyword`, `#wizKeywordsTags`, `.wiz-preset-pill`, `#wizSearchLocation`, `#wizWorkplaceType`, `#wizDailyLimit`, `#wizExecutionMode`, `#btnWizStep3Back`, `#btnWizStep3Next`
- Step 4 Elements: `#wizActiveProfileLabel`, `#wizDotLinkedin`, `#wizBadgeLinkedin`, `#wiz-linkedin-email`, `#wiz-linkedin-pass`, `#btnWizAutoLoginLinkedin`, `#wiz-msg-linkedin`, `#wizDotWellfound`, `#wizBadgeWellfound`, `#btnOpenLoginWellfound`, `#wizDotYc`, `#wizBadgeYc`, `#btnOpenLoginYc`, `#wizDotOtta`, `#wizBadgeOtta`, `#btnOpenLoginOtta`, `#btnWizStep4Back`, `#btnWizFinish`

#### B. Pricing & Credits Modal (`#pricingModal`)
- Modal Window: `bg-carbon border border-iron rounded-[2px] w-full max-w-lg`
- Re-architect from rogue amber to Axiom Ember:
  - Balance Readout: `#modalCreditBalance` (`text-2xl font-bold text-ember`)
  - Progress Meter: `#creditProgressBar` (Rectangular 2px bar `bg-ember`)
  - Promo Input: `#promoCodeInput`, Redeem Button: `#promoRedeemBtn` (`bg-ember hover:bg-ember-hover text-paper`), Feedback: `#promoFeedback`

#### C. 2FA / Authentication Code Modal (`#authCodeModal`)
- Window: `bg-carbon border border-iron rounded-[2px] max-w-md w-full p-6 space-y-4 font-mono`
- Elements: `#authCodeDesc`, Input: `#authCodeInput`, Error: `#authCodeError`, Submit: `#btnSubmitAuthCode` (`bg-ember hover:bg-ember-hover text-paper`)

---

## 4. Micro-Interaction States Matrix

| Component | Default | Hover | Active / Focus | Disabled | Loading / In-Flight | Error |
|-----------|---------|-------|----------------|----------|---------------------|-------|
| **Primary CTA Button** (`#btnStart`, `#btnInspApply`) | `bg-ember text-paper font-bold` | `bg-ember-hover` | `bg-ember-dark` | `opacity-40 cursor-not-allowed` | Spinner icon + `opacity-80` | N/A |
| **Secondary Button** (`#btnPause`, Refresh) | `bg-carbon border-iron text-fog` | `bg-graphite border-slate text-paper` | `bg-void border-iron` | `opacity-40 cursor-not-allowed` | Spin glyph + text | `border-rose-900 text-rose-400` |
| **Danger / Stop Button** (`#btnStop`) | `bg-carbon border-rose-900/60 text-rose-400` | `bg-graphite border-rose-700 text-rose-300` | `bg-void border-rose-800` | `opacity-40 cursor-not-allowed` | N/A | N/A |
| **Input / Select / Textarea** | `bg-void border-iron text-paper text-xs` | `border-slate` | `border-ember outline-none` | `bg-carbon text-steel opacity-50` | N/A | `border-rose-500 text-rose-200` |
| **Tab Button** (`.tab-btn`) | `border-transparent text-steel` | `text-fog` | `border-ember text-paper font-bold` | `opacity-30 pointer-events-none` | Pulse dot | N/A |
| **Job Card in List** (`.ats-job-card`)| `bg-void border-iron` | `bg-graphite border-slate` | `bg-graphite border-l-2 border-l-ember border-iron` | `opacity-40` | Spinner in list | N/A |
| **Preset Pills** (`.kw-preset-pill`) | `bg-void border-iron text-fog` | `bg-iron text-paper` | `bg-ember/20 border-ember text-ember` | `opacity-30` | N/A | N/A |

---

## 5. Responsive Breakpoint Rules

| Viewport | Width | Layout Adjustments |
|----------|-------|--------------------|
| **Ultra-Wide / Desktop** | `>=1400px` | Full 2-column master-detail layout (5 col / 7 col). Header controls sit in single line with full spacing. |
| **Laptop / Compact Desktop**| `1024px–1399px`| Master-detail maintains side-by-side with condensed headers (`gap-4`). Navigation tabs scroll horizontally without breaking layout. |
| **Tablet / Mobile** | `<1024px` | Master-detail converts to single-column vertical stack (Job List first, Inspector underneath). Header controls wrap into two neat rows. |

---

## 6. Implementation Checklist for Senior Engineer (`@engineer`)

- [ ] **CSS & Global Framework**:
  - Configure JetBrains Mono / BerkeleyMono typography.
  - Remove all drop shadows (`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-2xl`).
  - Standardize all borders to `rounded-[2px]`.
- [ ] **Global Header & Ribbon**:
  - Eliminate duplicate target platform dropdown clutter; standardize status badges.
  - Re-theme credit badge from rogue amber to Axiom Ember/Paper.
- [ ] **Tab 1 Re-Architecture**:
  - Replace gradient on `#aiConsensusCard` with flat `bg-void border border-iron`.
  - Rebalance inspector height: compact AI consensus ribbon and expand `#inspJobDesc` vertical reading area.
  - Replace consumer emojis (`📄`, `⚡`, `✉`, etc.) with terminal glyphs (`[>]`, `[+]`, `[x]`, `[!]`).
- [ ] **Tabs 2–6 Polish**:
  - Flat telemetry cards with high-contrast Fog/Paper typography.
  - Standardize form controls with sharp 2px borders and `focus:border-ember`.
  - Harmonize Vault credential cards into a unified session helper.
- [ ] **Modals & Dialogs**:
  - Re-skin Setup Wizard, Pricing Modal, and 2FA Modal to strict 2px Axiom flat dark standards.
- [ ] **Preservation Verification**:
  - Verify every element ID, class selector, and data attribute to ensure `public/app.js` runs with zero regression.
