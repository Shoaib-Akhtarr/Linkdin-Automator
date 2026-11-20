// Frontend Application Logic for Axiom // LinkedIn & ATS Automation Suite

let currentState = 'idle';
let currentProfile = {};
let currentSettings = {};

// Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const btnStart = document.getElementById('btnStart');
const btnPause = document.getElementById('btnPause');
const btnStop = document.getElementById('btnStop');

const reviewBanner = document.getElementById('reviewBanner');
const reviewJobTitle = document.getElementById('reviewJobTitle');
const btnApproveReview = document.getElementById('btnApproveReview');
const btnSkipReview = document.getElementById('btnSkipReview');

const metricToday = document.getElementById('metricToday');
const metricLimit = document.getElementById('metricLimit');
const metricRemaining = document.getElementById('metricRemaining');
const metricTotal = document.getElementById('metricTotal');
const metricSkipped = document.getElementById('metricSkipped');
const metricProgressBar = document.getElementById('metricProgressBar');

const currentJobCard = document.getElementById('currentJobCard');
const currentJobTitle = document.getElementById('currentJobTitle');
const currentJobDetails = document.getElementById('currentJobDetails');

const liveScreenshot = document.getElementById('liveScreenshot');
const liveScreenshotPlaceholder = document.getElementById('liveScreenshotPlaceholder');
const logContainer = document.getElementById('logContainer');
const btnClearLogs = document.getElementById('btnClearLogs');

// Tab Navigation (Axiom: Sharp monospaced border-b tabs)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('border-ember', 'text-paper', 'font-bold', 'border-blue-500', 'text-blue-400', 'neu-pressed', 'text-accent');
      b.classList.add('neu-raised-sm', 'text-text-secondary');
      const d = b.querySelector('.tab-indicator-dot');
      if (d) d.remove();
    });
    btn.classList.add('neu-pressed', 'text-accent', 'font-bold');
    btn.classList.remove('neu-raised-sm', 'text-text-secondary');
    if (!btn.querySelector('.tab-indicator-dot')) {
      const dot = document.createElement('span');
      dot.className = 'tab-indicator-dot w-2 h-2 rounded-full bg-highlight animate-pulse';
      dot.setAttribute('aria-hidden', 'true');
      btn.prepend(dot);
    }

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const target = document.getElementById(btn.getAttribute('data-tab'));
    if (target) target.classList.remove('hidden');

    if (btn.getAttribute('data-tab') === 'tab-history') {
      loadHistory();
  loadVault();
    }
  });
});

// Real-time Server-Sent Events (SSE)
function initEventStream() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('init', e => {
    const data = JSON.parse(e.data);
    updateStateUI(data.state);
    if (data.activePlatform) syncPlatformUI(data.activePlatform);
    if (data.stats) updateStatsUI(data.stats);
    if (data.currentJob) updateCurrentJobUI(data.currentJob);
    if (data.autopilot) updateAutopilotUI(data.autopilot);
    if (data.logs) {
      logContainer.innerHTML = '';
      data.logs.reverse().forEach(appendLog);
    }
  });

  eventSource.addEventListener('platform_change', e => {
    const data = JSON.parse(e.data);
    if (data.activePlatform) syncPlatformUI(data.activePlatform);
  });

  eventSource.addEventListener('autopilot_status', e => {
    const status = JSON.parse(e.data);
    updateAutopilotUI(status);
  });

  eventSource.addEventListener('state_change', e => {
    const state = JSON.parse(e.data);
    updateStateUI(state);
  });

  eventSource.addEventListener('stats_update', e => {
    const stats = JSON.parse(e.data);
    updateStatsUI(stats);
    loadHistory();
    fetchAndUpdateCredits();
  });

  eventSource.addEventListener('credits_update', e => {
    try {
      const data = JSON.parse(e.data);
      if (typeof data.credits === 'number') {
        currentCredits = data.credits;
        renderCreditBadge(currentCredits);
      }
    } catch (_) {}
  });

  eventSource.addEventListener('current_job', e => {
    const job = JSON.parse(e.data);
    updateCurrentJobUI(job);
  });

  eventSource.addEventListener('log', e => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
  });

  eventSource.addEventListener('client_message', e => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.message) {
        showClientNotificationModal(data.message, data.job);
      }
    } catch (_) {}
  });

  eventSource.addEventListener('auth_challenge_required', e => {
    try {
      const data = JSON.parse(e.data);
      openAuthCodeModal(data.platform || 'linkedin', data.message);
    } catch (_) {}
  });

  eventSource.addEventListener('platform_verified', e => {
    try {
      const data = JSON.parse(e.data);
      updateAuthUI(data.platform, true);
    } catch (_) {}
  });

  eventSource.addEventListener('screenshot', e => {
    const base64 = JSON.parse(e.data);
    if (base64) {
      liveScreenshot.src = `data:image/jpeg;base64,${base64}`;
      liveScreenshot.classList.remove('hidden');
      liveScreenshotPlaceholder.classList.add('hidden');
    }
  });

  eventSource.onerror = () => {
    console.warn('SSE connection closed, retrying in 3s...');
  };
}

function syncPlatformUI(platform) {
  const p = platform || 'all';
  const headerSelect = document.getElementById('headerPlatformSelect');
  const setSelect = document.getElementById('setPlatform');
  const barPlatform = document.getElementById('barPlatform');

  if (headerSelect) headerSelect.value = p;
  if (setSelect) setSelect.value = p;
  if (barPlatform) {
    const map = {
      all: 'ALL PLATFORMS (AUTO-ROTATE)',
      linkedin: 'LINKEDIN',
      wellfound: 'WELLFOUND STARTUPS',
      ycombinator: 'Y COMBINATOR',
      otta: 'OTTA TECH',
      weworkremotely: 'WE WORK REMOTELY',
      remoteok: 'REMOTEOK',
      jobicy: 'JOBICY',
      remote_ats: 'CURATED REMOTE ATS'
    };
    barPlatform.textContent = map[p] || p.toUpperCase();
  }
}

async function changePlatform(newPlatform) {
  syncPlatformUI(newPlatform);
  try {
    await fetch('/api/platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: newPlatform })
    });
  } catch (e) {
    console.error('Failed to change platform:', e);
  }
}

document.getElementById('headerPlatformSelect')?.addEventListener('change', e => {
  changePlatform(e.target.value);
});

document.getElementById('setPlatform')?.addEventListener('change', e => {
  changePlatform(e.target.value);
});

function updateStateUI(state) {
  currentState = state;
  if (statusText) statusText.textContent = state.toUpperCase().replace('_', ' ');

  if (state === 'running') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-[2px] border border-ember bg-carbon text-xs font-bold uppercase tracking-wider text-ember';
    statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-ember animate-pulse"></span><span id="statusText">RUNNING</span>';
    btnStart.classList.add('hidden');
    btnPause.classList.remove('hidden');
    btnStop.classList.remove('hidden');
    reviewBanner.classList.add('hidden');
  } else if (state === 'paused') {
    statusBadge.className = 'neu-raised-sm px-3 py-1.5 rounded-full-neu text-xs font-bold text-text-secondary flex items-center gap-2';
    statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-fog"></span><span id="statusText">PAUSED</span>';
    btnStart.classList.remove('hidden');
    btnStart.innerHTML = `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> <span>Resume</span> <span>→</span>`;
    btnPause.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else if (state === 'awaiting_review') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-[2px] border border-ember bg-graphite text-xs font-bold uppercase tracking-wider text-ember animate-pulse';
    statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-ember"></span><span id="statusText">REVIEW</span>';
    reviewBanner.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnPause.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    // idle or stopped
    statusBadge.className = 'neu-raised-sm px-3 py-1.5 rounded-full-neu text-xs font-bold text-text-muted flex items-center gap-2';
    statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-steel animate-pulse"></span><span id="statusText">IDLE</span>';
    btnStart.classList.remove('hidden');
    btnStart.innerHTML = `<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> <span>Start</span> <span>→</span>`;
    btnPause.classList.add('hidden');
    btnStop.classList.add('hidden');
    reviewBanner.classList.add('hidden');
  }
}

function updateStatsUI(stats) {
  metricToday.textContent = stats.todayApplied || 0;
  metricLimit.textContent = `/ ${stats.dailyLimit || 25} LIMIT`;
  metricRemaining.textContent = stats.remainingToday || 0;
  metricTotal.textContent = stats.totalApplied || 0;
  metricSkipped.textContent = (stats.skipped || 0) + (stats.failed || 0);

  const pct = Math.min(100, Math.round(((stats.todayApplied || 0) / (stats.dailyLimit || 25)) * 100));
  metricProgressBar.style.width = `${pct}%`;

  if (stats.byPlatform) {
    const elIn = document.getElementById('statPlatLinkedIn');
    const elWf = document.getElementById('statPlatWellfound');
    const elWwr = document.getElementById('statPlatWWR');
    const elRok = document.getElementById('statPlatRemoteOK');
    const elJbc = document.getElementById('statPlatJobicy');
    const elAt = document.getElementById('statPlatRemoteAts');
    if (elIn) elIn.textContent = stats.byPlatform.linkedin || 0;
    if (elWf) elWf.textContent = stats.byPlatform.wellfound || 0;
    const elYc = document.getElementById('statPlatYC');
    const elOt = document.getElementById('statPlatOtta');
    if (elYc) elYc.textContent = stats.byPlatform.ycombinator || 0;
    if (elOt) elOt.textContent = stats.byPlatform.otta || 0;
    if (elWwr) elWwr.textContent = stats.byPlatform.weworkremotely || 0;
    if (elRok) elRok.textContent = stats.byPlatform.remoteok || 0;
    if (elJbc) elJbc.textContent = stats.byPlatform.jobicy || 0;
    if (elAt) elAt.textContent = stats.byPlatform.remote_ats || 0;
  }
}

function updateCurrentJobUI(job) {
  if (job) {
    currentJobCard.classList.remove('hidden');
    currentJobTitle.textContent = job.title;
    currentJobDetails.textContent = `${job.company} • ${job.location}`;
    reviewJobTitle.textContent = `Reviewing: "${job.title}" at "${job.company}"`;
  } else {
    currentJobCard.classList.add('hidden');
  }
}

function appendLog(entry) {
  const line = document.createElement('div');
  line.className = 'flex items-start gap-2 font-mono text-[11px] leading-relaxed';

  let colorClass = 'text-fog';
  let prefix = '<span class="text-steel">&gt;</span>';
  if (entry.type === 'success') {
    colorClass = 'text-paper font-bold';
    prefix = '<span class="text-ember font-bold">✓</span>';
  } else if (entry.type === 'warn') {
    colorClass = 'text-fog';
    prefix = '<span class="text-ember font-bold">!</span>';
  } else if (entry.type === 'error') {
    colorClass = 'text-rose-400 font-bold';
    prefix = '<span class="text-rose-500 font-bold">×</span>';
  }

  line.innerHTML = `
    <span class="text-steel select-none text-[10px] whitespace-nowrap">[${entry.timestamp}]</span>
    <span class="select-none">${prefix}</span>
    <span class="${colorClass} break-all">${escapeHtml(entry.message)}</span>
  `;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

btnClearLogs.addEventListener('click', () => {
  logContainer.innerHTML = '';
});

// Control Button Actions
btnStart.addEventListener('click', async () => {
  // Pre-flight setup & authentication verification
  try {
    const statusRes = await fetch('/api/system/setup-status');
    const status = await statusRes.json();
    if (!status.isSetupComplete) {
      if (!status.resumeExists || !status.hasProfile) {
        alert('⚠️ CV & Candidate Profile Incomplete\n\nPlease upload your CV / resume and complete your profile before starting automation.');
        openSetupWizard(2);
        return;
      }
      if (!status.hasChromeProfile) {
        alert('⚠️ Chrome Profile Not Selected\n\nPlease select your Google Chrome profile in the Setup Wizard.');
        openSetupWizard(1);
        return;
      }
    }
    
    // Check if live session is logged in
    const loginRes = await fetch('/api/system/verify-logins');
    const loginData = await loginRes.json();
    if (loginData.cdpConnected && !loginData.linkedin && (currentSettings.activePlatform === 'all' || currentSettings.activePlatform === 'linkedin')) {
      const confirmRun = confirm('⚠️ LinkedIn Session Notice:\n\nActive LinkedIn session was not detected in your selected Chrome profile.\n\nWould you like to open LinkedIn in Chrome to log in first?\n• Click OK to open LinkedIn for login\n• Click Cancel to attempt automation anyway');
      if (confirmRun) {
        openPlatformLogin('linkedin');
        return;
      }
    }
  } catch (err) {
    console.warn('Pre-flight check note:', err);
  }

  btnStart.disabled = true;
  
  // ── Credit pre-flight check ───────────────────────────────────────────────
  const creditOk = await checkCreditsBeforeRun(currentSettings?.dailyLimit || 10);
  if (!creditOk) {
    btnStart.disabled = false;
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────
  btnStart.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin fill-current" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> <span>Starting...</span>`;
  try {
    const res = await fetch('/api/start', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) {
      btnStart.disabled = false;
      renderControlButtons('idle');
      alert(`⚠️ Cannot Start: ${data.error || 'Start request rejected'}`);
      if (res.status === 402 || (data.error && data.error.includes('credits'))) {
        openPricingModal();
      }
      return;
    }
  } catch (e) {
    btnStart.disabled = false;
  }
});

btnPause.addEventListener('click', async () => {
  await fetch('/api/pause', { method: 'POST' });
});

btnStop.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
});

btnApproveReview.addEventListener('click', async () => {
  await fetch('/api/approve', { method: 'POST' });
  reviewBanner.classList.add('hidden');
});

btnSkipReview.addEventListener('click', async () => {
  await fetch('/api/skip', { method: 'POST' });
  reviewBanner.classList.add('hidden');
});

// 24/7 Autopilot Scheduler Controller
let currentAutopilot = { enabled: false, nextRunTime: null, intervalMinutes: 120, batchSize: 10 };
let countdownInterval = null;

function updateAutopilotUI(status) {
  if (!status) return;
  currentAutopilot = status;

  const badge = document.getElementById('autopilotBadge');
  const btn = document.getElementById('btnToggleAutopilot');
  const countdown = document.getElementById('autopilotCountdown');
  const batchInput = document.getElementById('autoBatchSize');
  const intervalInput = document.getElementById('autoIntervalMins');

  if (batchInput && status.batchSize) batchInput.value = status.batchSize;
  if (intervalInput && status.intervalMinutes) intervalInput.value = status.intervalMinutes;

  if (status.enabled) {
    if (badge) {
      badge.textContent = 'ACTIVE';
      badge.className = 'px-2.5 py-0.5 rounded-[4px] border border-[#4ade80]/60 bg-[rgba(74,222,128,0.12)] text-[#4ade80] text-[10px] font-mono font-bold uppercase';
    }
    if (btn) {
      btn.innerHTML = '<span>STOP AUTOPILOT</span> <span>&times;</span>';
      btn.className = 'neu-btn px-4 py-2 rounded-sm-neu border border-[#f87171]/80 text-[#f87171] hover:bg-[rgba(248,113,113,0.12)] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition';
    }
  } else {
    if (badge) {
      badge.textContent = 'INACTIVE';
      badge.className = 'px-2.5 py-0.5 rounded-[4px] border border-text-muted/60 text-text-muted text-[10px] font-mono font-bold uppercase';
    }
    if (btn) {
      btn.innerHTML = '<span>TURN AUTOPILOT ON</span> <span>&rarr;</span>';
      btn.className = 'neu-btn px-4 py-2 rounded-sm-neu border border-text-primary/80 text-text-primary hover:bg-surface text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition';
    }
    if (countdown) countdown.textContent = '--';
  }

  // Handle live countdown
  if (countdownInterval) clearInterval(countdownInterval);
  if (status.enabled && status.nextRunTime) {
    tickCountdown();
    countdownInterval = setInterval(tickCountdown, 1000);
  }
}

function tickCountdown() {
  const countdown = document.getElementById('autopilotCountdown');
  if (!countdown) return;
  if (!currentAutopilot.enabled || !currentAutopilot.nextRunTime) {
    countdown.textContent = '--';
    return;
  }
  const diff = currentAutopilot.nextRunTime - Date.now();
  if (diff <= 0) {
    countdown.textContent = 'Triggering now...';
    return;
  }
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  countdown.textContent = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

document.getElementById('btnToggleAutopilot')?.addEventListener('click', async () => {
  const batchSize = Number(document.getElementById('autoBatchSize').value) || 10;
  const intervalMinutes = Number(document.getElementById('autoIntervalMins').value) || 120;

  if (currentAutopilot.enabled) {
    const res = await fetch('/api/autopilot/stop', { method: 'POST' });
    const data = await res.json();
    updateAutopilotUI(data.status);
  } else {
    const res = await fetch('/api/autopilot/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes, batchSize })
    });
    const data = await res.json();
    updateAutopilotUI(data.status);
  }
});

// Profile Management
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    currentProfile = await res.json();

    document.getElementById('profFullName').value = currentProfile.personal?.fullName || '';
    document.getElementById('profEmail').value = currentProfile.personal?.email || '';
    document.getElementById('profPhone').value = currentProfile.personal?.phone || '';
    document.getElementById('profCity').value = currentProfile.personal?.address?.city || '';
    document.getElementById('profCountry').value = currentProfile.personal?.address?.country || '';

    const profLoc = document.getElementById('profLocation');
    if (profLoc) {
      profLoc.value = currentProfile.personal?.address?.city ? `${currentProfile.personal.address.city}, ${currentProfile.personal.address.country || ''}` : '';
    }

    document.getElementById('profAuthorized').value = currentProfile.workAuthorization?.legallyAuthorized || 'Yes';
    document.getElementById('profSponsorship').value = currentProfile.workAuthorization?.requireSponsorship || 'No';
    document.getElementById('profSalaryNumeric').value = currentProfile.compensationAndAvailability?.desiredSalaryNumeric || 50000;
    document.getElementById('profNoticeWeeks').value = currentProfile.compensationAndAvailability?.noticePeriodWeeks || 2;
    document.getElementById('profLinkedin').value = currentProfile.personal?.links?.linkedin || '';
    document.getElementById('profGithub').value = currentProfile.personal?.links?.github || '';

    renderSkillsTable(currentProfile.workExperienceYears || {});
    if (typeof loadWizardCvFields === 'function') loadWizardCvFields();
    if (typeof evaluateWizardProgress === 'function') evaluateWizardProgress();
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

function renderSkillsTable(skills) {
  const container = document.getElementById('skillsTable');
  container.innerHTML = '';

  for (const [skill, years] of Object.entries(skills)) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-2.5 rounded-sm-neu neu-pressed gap-3';
    row.innerHTML = `
      <span class="text-xs font-semibold text-text-primary">${escapeHtml(skill)}</span>
      <div class="flex items-center gap-2">
        <input type="number" min="0" max="25" value="${years}" data-skill="${escapeHtml(skill)}" class="skill-input w-16 neu-input rounded-sm-neu px-2 py-1 text-xs text-text-primary text-right font-mono" />
        <span class="text-[10px] text-text-muted uppercase font-mono">YRS</span>
      </div>
    `;
    container.appendChild(row);
  }
}

document.getElementById('btnAddSkill').addEventListener('click', () => {
  const name = prompt('Enter skill name (e.g. PyTorch, FastAPI, Docker):');
  if (name && name.trim()) {
    if (!currentProfile.workExperienceYears) currentProfile.workExperienceYears = {};
    currentProfile.workExperienceYears[name.trim()] = 2;
    renderSkillsTable(currentProfile.workExperienceYears);
  }
});

document.getElementById('btnSaveProfile').addEventListener('click', async () => {
  currentProfile.personal.fullName = document.getElementById('profFullName').value;
  currentProfile.personal.email = document.getElementById('profEmail').value;
  currentProfile.personal.phone = document.getElementById('profPhone').value;
  currentProfile.personal.address.city = document.getElementById('profCity').value;
  currentProfile.personal.address.country = document.getElementById('profCountry').value;
  if (!currentProfile.personal.links) currentProfile.personal.links = {};
  currentProfile.personal.links.linkedin = document.getElementById('profLinkedin').value;
  currentProfile.personal.links.github = document.getElementById('profGithub').value;

  currentProfile.workAuthorization.legallyAuthorized = document.getElementById('profAuthorized').value;
  currentProfile.workAuthorization.requireSponsorship = document.getElementById('profSponsorship').value;
  currentProfile.compensationAndAvailability.desiredSalaryNumeric = Number(document.getElementById('profSalaryNumeric').value);
  currentProfile.compensationAndAvailability.noticePeriodWeeks = Number(document.getElementById('profNoticeWeeks').value);

  document.querySelectorAll('.skill-input').forEach(input => {
    const skill = input.getAttribute('data-skill');
    currentProfile.workExperienceYears[skill] = Number(input.value);
  });

  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentProfile)
  });

  if (res.ok) {
    alert('✓ Profile and screening answers successfully saved!');
    if (typeof evaluateWizardProgress === 'function') evaluateWizardProgress();
  } else {
    alert('Error saving profile.');
  }
});

// Settings Management
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    currentSettings = await res.json();

    const activePlat = currentSettings.activePlatform || 'all';
    syncPlatformUI(activePlat);

    document.getElementById('setMode').value = currentSettings.execution?.mode || 'hybrid';
    document.getElementById('setDailyLimit').value = currentSettings.execution?.dailyApplicationLimit || 25;
    document.getElementById('setDatePosted').value = currentSettings.search?.datePosted || 'pastWeek';

    document.getElementById('setKeywords').value = (currentSettings.search?.keywords || []).join(', ');
    
    const locVal = currentSettings.search?.location || 'Worldwide';
    document.getElementById('setLocation').value = locVal;

    const wpVal = currentSettings.search?.workplaceType || (currentSettings.search?.remoteOnly ? 'remote' : 'all');
    document.getElementById('setWorkplaceType').value = wpVal;

    const applyTypeVal = currentSettings.search?.applyType || (currentSettings.search?.easyApplyOnly === false ? 'all' : 'easy_apply');
    document.getElementById('setApplyType').value = applyTypeVal;

    document.getElementById('setBlacklist').value = (currentSettings.search?.blacklistCompanies || []).join(', ');

    const intelli = currentSettings.intelligence || {};
    document.getElementById('setIntelliReadJD').checked = intelli.readFullDescription !== false;
    document.getElementById('setIntelliClearance').checked = intelli.filterSecurityClearance !== false;
    document.getElementById('setIntelliCitizenship').checked = intelli.filterCitizenshipRestricted !== false;
    document.getElementById('setIntelliDynamicCV').checked = intelli.dynamicCVGeneration !== false;

    updateActiveBar(locVal, wpVal, currentSettings.execution?.mode || 'hybrid', applyTypeVal);
    if (typeof loadWizardJobs === 'function') loadWizardJobs();
    if (typeof evaluateWizardProgress === 'function') evaluateWizardProgress();
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function updateActiveBar(location, workplace, mode, applyType) {
  const barLoc = document.getElementById('barLocation');
  const barWp = document.getElementById('barWorkplace');
  const barMode = document.getElementById('barMode');
  const barApplyType = document.getElementById('barApplyType');

  if (barLoc) barLoc.textContent = location ? location.toUpperCase() : 'WORLDWIDE';
  if (barWp) {
    const wpLabels = { remote: 'REMOTE ONLY', hybrid: 'HYBRID', onsite: 'ON-SITE', all: 'ALL WORKPLACES' };
    barWp.textContent = wpLabels[workplace] || workplace.toUpperCase();
  }
  if (barMode) barMode.textContent = mode ? mode.toUpperCase() : 'HYBRID';
  if (barApplyType) {
    barApplyType.textContent = (applyType === 'all') ? 'ALL JOBS (EASY APPLY + ATS)' : 'EASY APPLY ONLY';
  }
}

// Quick Location Pills
document.querySelectorAll('.loc-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const loc = pill.getAttribute('data-loc');
    document.getElementById('setLocation').value = loc;
  });
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const selectedPlat = document.getElementById('setPlatform')?.value || 'all';
  currentSettings.activePlatform = selectedPlat;
  syncPlatformUI(selectedPlat);

  currentSettings.execution.mode = document.getElementById('setMode').value;
  currentSettings.execution.easyApplyMode = currentSettings.execution.mode;
  currentSettings.execution.externalMode = currentSettings.execution.mode;
  currentSettings.execution.pauseForReviewInHybridMode = (currentSettings.execution.mode === 'review');
  currentSettings.externalApply = currentSettings.externalApply || {};
  currentSettings.externalApply.autoSubmitStandardATS = true;
  currentSettings.externalApply.mode = currentSettings.execution.mode;
  currentSettings.execution.dailyApplicationLimit = Number(document.getElementById('setDailyLimit').value);
  currentSettings.search.datePosted = document.getElementById('setDatePosted').value;

  const newApplyType = document.getElementById('setApplyType').value;
  currentSettings.search.applyType = newApplyType;
  currentSettings.search.easyApplyOnly = (newApplyType === 'easy_apply');

  currentSettings.search.keywords = document.getElementById('setKeywords').value
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  const newLoc = document.getElementById('setLocation').value.trim();
  const newWp = document.getElementById('setWorkplaceType').value;

  currentSettings.search.location = newLoc;
  currentSettings.search.workplaceType = newWp;
  currentSettings.search.remoteOnly = (newWp === 'remote');

  currentSettings.search.blacklistCompanies = document.getElementById('setBlacklist').value
    .split(',')
    .map(b => b.trim())
    .filter(Boolean);

  currentSettings.intelligence = currentSettings.intelligence || {};
  currentSettings.intelligence.readFullDescription = document.getElementById('setIntelliReadJD').checked;
  currentSettings.intelligence.filterSecurityClearance = document.getElementById('setIntelliClearance').checked;
  currentSettings.intelligence.filterCitizenshipRestricted = document.getElementById('setIntelliCitizenship').checked;
  currentSettings.intelligence.dynamicCVGeneration = document.getElementById('setIntelliDynamicCV').checked;

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentSettings)
  });

  if (res.ok) {
    updateActiveBar(newLoc, newWp, currentSettings.execution.mode, newApplyType);
    alert('✓ Settings & Platform Directives successfully saved!');
  } else {
    alert('Error saving settings.');
  }
});

// History Management
let currentHistoryFilter = 'all';

async function loadHistory(platformFilter) {
  if (platformFilter) currentHistoryFilter = platformFilter;
  try {
    const res = await fetch(`/api/applications?platform=${encodeURIComponent(currentHistoryFilter)}`);
    const apps = await res.json();
    const tbody = document.getElementById('historyTableBody');

    if (!apps || apps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-steel font-mono">// No applications recorded yet for this filter.</td></tr>';
      return;
    }

    tbody.innerHTML = apps.map(app => {
      let date = '—';
      if (app.status === 'previously_applied') {
        date = '<span class="text-steel italic">PRIOR</span>';
      } else if (app.appliedAt) {
        date = new Date(app.appliedAt).toISOString().split('T')[0];
      }

      // Minimalist Monospaced Platform Tag
      const p = (app.platform || 'linkedin').toLowerCase();
      let platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">LINKEDIN</span>';
      if (p === 'wellfound') {
        platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">WELLFOUND</span>';
      } else if (p === 'weworkremotely') {
        platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">WWR</span>';
      } else if (p === 'remoteok') {
        platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">REMOTEOK</span>';
      } else if (p === 'jobicy') {
        platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">JOBICY</span>';
      } else if (p === 'remote_ats' || p === 'greenhouse' || p === 'lever' || p === 'ashby') {
        platformBadge = '<span class="px-1.5 py-0.5 rounded-[2px] bg-void border border-iron text-fog font-medium text-[10px] uppercase">ATS</span>';
      }

      // Axiom Status Badge
      let statusBadge = '<span class="px-1.5 py-0.5 rounded-[2px] border border-ember text-ember font-bold text-[10px] uppercase">APPLIED</span>';
      if (app.status === 'previously_applied') {
        statusBadge = '<span class="px-1.5 py-0.5 rounded-[2px] border border-iron text-steel font-medium text-[10px] uppercase" title="Previously applied">ALREADY APPLIED</span>';
      } else if (app.status === 'skipped') {
        statusBadge = '<span class="px-1.5 py-0.5 rounded-[2px] border border-iron text-ash font-medium text-[10px] uppercase">SKIPPED</span>';
      } else if (app.status === 'failed') {
        statusBadge = '<span class="px-1.5 py-0.5 rounded-[2px] border border-rose-900/60 text-rose-400 font-bold text-[10px] uppercase">FAILED</span>';
      }

      // CV Artifact Link
      let cvContent = '<span class="text-steel">—</span>';
      if (app.status === 'previously_applied') {
        cvContent = `<span class="text-steel text-[11px] truncate max-w-[200px] block" title="${escapeHtml(app.notes || 'Already applied')}">PREVIOUS_BADGE</span>`;
      } else if (app.notes) {
        const cvMatch = app.notes.match(/Tailored ATS CV:\s*([^\s,]+)/i);
        if (cvMatch && cvMatch[1]) {
          const cvFile = cvMatch[1].trim();
          cvContent = `<a href="/tailored_cvs/${encodeURIComponent(cvFile)}" target="_blank" class="text-ember hover:underline font-mono text-[11px] flex items-center gap-1" title="View tailored vector PDF">📄 ${escapeHtml(cvFile)} →</a>`;
        } else {
          cvContent = `<span class="text-ash text-[11px] truncate max-w-[200px] block" title="${escapeHtml(app.notes)}">${escapeHtml(app.notes)}</span>`;
        }
      }

      const hasNumericId = app.jobId && /^\d+$/.test(String(app.jobId).trim());
      const link = hasNumericId
        ? `<a href="https://www.linkedin.com/jobs/view/${app.jobId}/" target="_blank" class="text-ember hover:underline font-bold text-xs">View →</a>`
        : (app.url ? `<a href="${escapeHtml(app.url)}" target="_blank" class="text-ember hover:underline font-bold text-xs">View →</a>` : '<span class="text-steel">—</span>');

      return `
        <tr class="hover:bg-void transition-colors">
          <td class="py-2.5 px-3 text-steel whitespace-nowrap text-[11px]">${date}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${platformBadge}</td>
          <td class="py-2.5 px-3 font-semibold text-paper">${escapeHtml(app.title)}</td>
          <td class="py-2.5 px-3 text-fog">${escapeHtml(app.company)}</td>
          <td class="py-2.5 px-3 text-ash whitespace-nowrap">${escapeHtml(app.location)}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
          <td class="py-2.5 px-3">${cvContent}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${link}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// Platform Filter Buttons in History
document.querySelectorAll('.plat-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.plat-filter-btn').forEach(b => {
      b.className = 'plat-filter-btn px-3 py-1 rounded-[2px] bg-void border border-iron text-steel hover:text-paper text-xs transition cursor-pointer';
    });
    btn.className = 'plat-filter-btn px-3 py-1 rounded-[2px] bg-ember text-paper font-bold text-xs transition cursor-pointer';
    const plat = btn.getAttribute('data-platform');
    loadHistory(plat);
  });
});

// Export CSV
document.getElementById('btnExportCsv').addEventListener('click', async () => {
  const res = await fetch(`/api/applications?platform=${encodeURIComponent(currentHistoryFilter)}`);
  const apps = await res.json();
  if (!apps || apps.length === 0) {
    alert('No applications to export.');
    return;
  }

  const headers = ['Date', 'Platform', 'Job ID', 'Title', 'Company', 'Location', 'Status', 'Notes'];
  const rows = apps.map(a => [
    `"${a.appliedAt || ''}"`,
    `"${a.platform || 'linkedin'}"`,
    `"${a.jobId || ''}"`,
    `"${(a.title || '').replace(/"/g, '""')}"`,
    `"${(a.company || '').replace(/"/g, '""')}"`,
    `"${(a.location || '').replace(/"/g, '""')}"`,
    `"${a.status || ''}"`,
    `"${(a.notes || '').replace(/"/g, '""')}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `axiom_applications_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  initEventStream();
  loadProfile();
  loadSettings();
  loadHistory();
  if (typeof syncProfileAndWizardInputs === 'function') syncProfileAndWizardInputs();
  if (typeof loadWizardProfiles === 'function') loadWizardProfiles();
  if (typeof evaluateWizardProgress === 'function') evaluateWizardProgress();
});


// ==========================================
// Universal Platform Credentials & Vault Logic
// ==========================================

async function loadVault() {
  const statusEl = document.getElementById('vaultOverallStatus');
  if (statusEl) statusEl.textContent = 'CHECKING...';

  try {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    if (!data) return;

    let configuredCount = 0;
    const platforms = ['otta', 'linkedin', 'wellfound', 'ycombinator', 'email'];

    platforms.forEach(plat => {
      const info = data[plat];
      const dot = document.getElementById(`status-dot-${plat}`);
      const badge = document.getElementById(`status-badge-${plat}`);
      const emailInput = document.getElementById(`vault-${plat}-email`);
      const passInput = document.getElementById(`vault-${plat}-pass`);
      const apiInput = document.getElementById(`vault-${plat}-api`);

      if (info && info.configured) {
        configuredCount++;
        if (dot) {
          dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50';
        }
        if (badge) {
          badge.textContent = 'CONFIGURED';
          badge.className = 'text-[10px] text-emerald-400 font-bold';
        }
        if (emailInput && info.email && !emailInput.value) {
          emailInput.value = info.email;
        }
        if (passInput && info.hasPassword && !passInput.value) {
          passInput.placeholder = '•••••••• (Stored Securely)';
        }
        if (apiInput && info.hasApiKey && !apiInput.value) {
          apiInput.placeholder = '•••••••••••••••• (Active)';
        }
      } else {
        if (dot) {
          dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
        }
        if (badge) {
          badge.textContent = 'SETUP REQUIRED';
          badge.className = 'text-[10px] text-amber-400';
        }
      }
    });

    if (statusEl) {
      statusEl.textContent = `${configuredCount}/${platforms.length} ACTIVE`;
      statusEl.className = configuredCount >= 3 
        ? 'px-2 py-0.5 rounded-[2px] bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold text-[11px]'
        : 'px-2 py-0.5 rounded-[2px] bg-amber-950 text-amber-400 border border-amber-800 font-bold text-[11px]';
    }
  } catch (err) {
    console.error('Error loading vault credentials:', err);
    if (statusEl) statusEl.textContent = 'OFFLINE';
  }
}

async function savePlatformCreds(platform) {
  const emailInput = document.getElementById(`vault-${platform}-email`);
  const passInput = document.getElementById(`vault-${platform}-pass`);
  const apiInput = document.getElementById(`vault-${platform}-api`);
  const msgEl = document.getElementById(`verify-msg-${platform}`);

  const payload = {
    email: emailInput ? emailInput.value.trim() : '',
    password: passInput ? passInput.value : '',
    apiKey: apiInput ? apiInput.value.trim() : ''
  };

  if (msgEl) {
    msgEl.textContent = 'Saving to DPAPI vault...';
    msgEl.className = 'text-[10px] text-ember';
  }

  try {
    const res = await fetch(`/api/credentials/${platform}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      if (msgEl) {
        msgEl.textContent = '✓ Saved in encrypted vault';
        msgEl.className = 'text-[10px] text-emerald-400';
      }
      setTimeout(loadVault, 400);
    } else {
      if (msgEl) {
        msgEl.textContent = `✗ Error: ${result.error || 'Could not save'}`;
        msgEl.className = 'text-[10px] text-rose-400';
      }
    }
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = `✗ ${e.message}`;
      msgEl.className = 'text-[10px] text-rose-400';
    }
  }
}

async function verifyPlatformCreds(platform) {
  const msgEl = document.getElementById(`verify-msg-${platform}`);
  if (msgEl) {
    msgEl.textContent = 'Testing connection / session...';
    msgEl.className = 'text-[10px] text-steel animate-pulse';
  }

  try {
    const res = await fetch(`/api/credentials/verify/${platform}`, { method: 'POST' });
    const result = await res.json();
    if (msgEl) {
      msgEl.textContent = result.message || (result.success ? '✓ Verified' : '✗ Verification failed');
      msgEl.className = result.success ? 'text-[10px] text-emerald-400 font-semibold' : 'text-[10px] text-amber-400';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = `Verification note: ${err.message}`;
      msgEl.className = 'text-[10px] text-amber-400';
    }
  }
}

// Autonomous Silent Login & 2FA Handler
let currentAuthChallengePlatform = 'linkedin';

async function autoLoginPlatform(platform = 'linkedin', isWizard = false) {
  const emailInput = isWizard 
    ? document.getElementById(`wiz-${platform}-email`)
    : (document.getElementById(`vault-${platform}-email`) || document.getElementById(`wiz-${platform}-email`));
  const passInput = isWizard
    ? document.getElementById(`wiz-${platform}-pass`)
    : (document.getElementById(`vault-${platform}-pass`) || document.getElementById(`wiz-${platform}-pass`));
  const msgEl = isWizard
    ? document.getElementById(`wiz-msg-${platform}`)
    : (document.getElementById(`verify-msg-${platform}`) || document.getElementById(`wiz-msg-${platform}`));
  const btn = isWizard
    ? document.getElementById(`btnWizAutoLogin${platform.charAt(0).toUpperCase() + platform.slice(1)}`)
    : document.getElementById(`btnAutoLogin${platform.charAt(0).toUpperCase() + platform.slice(1)}`);

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Opening Chrome & Logging in...</span>';
  }
  if (msgEl) {
    msgEl.textContent = 'Launching Chrome profile and logging in...';
    msgEl.className = 'text-[10px] text-amber-400 font-semibold animate-pulse';
  }

  try {
    const res = await fetch('/api/auth/auto-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, email, password })
    });
    const data = await res.json();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>⚡ Auto-Login & Start Automation</span>';
    }

    if (data.status === 'success') {
      if (msgEl) {
        msgEl.textContent = '✓ Verified! Starting Autonomous Apply...';
        msgEl.className = 'text-[10px] text-emerald-400 font-bold animate-pulse';
      }
      updateAuthUI(platform, true);
      // Auto-trigger engine run immediately
      fetch('/api/start', { method: 'POST' }).catch(() => {});
      // Switch to main dashboard view automatically
      document.querySelector('.tab-btn[data-tab="tab-dashboard"]')?.click();
      if (typeof closeSetupWizard === 'function') closeSetupWizard();
    } else if (data.status === 'challenge_required') {
      if (msgEl) {
        msgEl.textContent = '🔐 2FA Code required. Enter the PIN in the popup.';
        msgEl.className = 'text-[10px] text-amber-400 font-bold';
      }
      openAuthCodeModal(platform, data.message);
    } else if (data.status === 'missing_credentials') {
      if (msgEl) {
        msgEl.textContent = '⚠️ Please enter your email and password above.';
        msgEl.className = 'text-[10px] text-amber-400 font-bold';
      }
    } else if (data.status === 'bad_credentials') {
      if (msgEl) {
        msgEl.textContent = `❌ ${data.message}`;
        msgEl.className = 'text-[10px] text-red-400 font-bold';
      }
      alert(`❌ Login Failed: ${data.message}\n\nPlease check your email & password and try again.`);
    } else {
      if (msgEl) {
        msgEl.textContent = data.message || 'Status pending...';
      }
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>⚡ Auto-Login & Start Automation</span>';
    }
    if (msgEl) {
      msgEl.textContent = `Error: ${err.message}`;
      msgEl.className = 'text-[10px] text-red-400 font-bold';
    }
  }
}

function openAuthCodeModal(platform, message) {
  currentAuthChallengePlatform = platform;
  const modal = document.getElementById('authCodeModal');
  const desc = document.getElementById('authCodeDesc');
  const input = document.getElementById('authCodeInput');
  const err = document.getElementById('authCodeError');

  if (desc && message) desc.textContent = message;
  if (input) { input.value = ''; input.focus(); }
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  if (modal) modal.classList.remove('hidden');
}

function closeAuthCodeModal() {
  const modal = document.getElementById('authCodeModal');
  if (modal) modal.classList.add('hidden');
}

async function submitAuthCode() {
  const input = document.getElementById('authCodeInput');
  const err = document.getElementById('authCodeError');
  const btn = document.getElementById('btnSubmitAuthCode');
  const code = input ? input.value.trim() : '';

  if (!code) {
    if (err) { err.textContent = 'Please enter the verification code.'; err.classList.remove('hidden'); }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Verifying Code...';
  }

  try {
    const res = await fetch('/api/auth/submit-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: currentAuthChallengePlatform || 'linkedin', code })
    });
    const data = await res.json();

    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Verify & Continue';
    }

    if (data.status === 'success') {
      closeAuthCodeModal();
      updateAuthUI(currentAuthChallengePlatform || 'linkedin', true);
      // Auto-trigger engine run immediately
      fetch('/api/start', { method: 'POST' }).catch(() => {});
      // Switch to main dashboard view automatically
      document.querySelector('.tab-btn[data-tab="tab-dashboard"]')?.click();
      if (typeof closeSetupWizard === 'function') closeSetupWizard();
    } else if (data.status === 'bad_code') {
      if (err) {
        err.textContent = data.message || 'Incorrect verification code. Please check your email or phone and try again.';
        err.classList.remove('hidden');
      }
    } else {
      if (err) {
        err.textContent = data.message || 'Verification failed.';
        err.classList.remove('hidden');
      }
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Verify & Continue';
    }
    if (err) {
      err.textContent = `Error: ${e.message}`;
      err.classList.remove('hidden');
    }
  }
}

// Attach vault reload button
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('btnRefreshVault');
  if (refreshBtn) refreshBtn.addEventListener('click', loadVault);

  // Hook tab switch
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-tab') === 'tab-vault') {
        loadVault();
      }
    });
  });
});


// ============================================================
// PROFILE & GUIDED SETUP WIZARD (UNIFIED HUB)
// ============================================================
let wizardCurrentStep = 1;
let wizardMaxUnlockedStep = 1;
let detectedChromeProfiles = [];
let wizardKeywords = [];
let profileViewMode = 'guided'; // 'guided' | 'full'

const setupWizardModal = document.getElementById('setupWizardModal');
const btnOpenSetupWizard = document.getElementById('btnOpenSetupWizard');
const btnCloseWizard = document.getElementById('btnCloseWizard');

function setProfileViewMode(mode) {
  profileViewMode = mode;
  const btnGuided = document.getElementById('btnViewModeGuided');
  const btnFull = document.getElementById('btnViewModeFull');

  if (mode === 'full') {
    if (btnFull) {
      btnFull.classList.add('neu-raised', 'text-accent');
      btnFull.classList.remove('text-text-secondary');
    }
    if (btnGuided) {
      btnGuided.classList.remove('neu-raised', 'text-accent');
      btnGuided.classList.add('text-text-secondary');
    }
    // Reveal all 4 steps
    for (let i = 1; i <= 4; i++) {
      const content = document.getElementById(`stepContent${i}`);
      if (content) content.classList.remove('hidden');
    }
    renderWizardKeywords();
    updateStep4ProfileLabel();
  } else {
    if (btnGuided) {
      btnGuided.classList.add('neu-raised', 'text-accent');
      btnGuided.classList.remove('text-text-secondary');
    }
    if (btnFull) {
      btnFull.classList.remove('neu-raised', 'text-accent');
      btnFull.classList.add('text-text-secondary');
    }
    goToWizardStep(wizardCurrentStep);
  }
}

document.getElementById('btnViewModeGuided')?.addEventListener('click', () => setProfileViewMode('guided'));
document.getElementById('btnViewModeFull')?.addEventListener('click', () => setProfileViewMode('full'));
document.getElementById('btnSaveProfileTop')?.addEventListener('click', () => {
  document.getElementById('btnSaveProfile')?.click();
});

function syncProfileAndWizardInputs() {
  const pairs = [
    ['profFullName', 'wizFullName'],
    ['profEmail', 'wizEmail'],
    ['profPhone', 'wizPhone'],
    ['profLocation', 'wizLocation'],
    ['profAuthorized', 'wizAuthorized'],
    ['profSponsorship', 'wizSponsorship'],
    ['profLinkedin', 'wizLinkedin'],
    ['profGithub', 'wizGithub']
  ];
  pairs.forEach(([pId, wId]) => {
    const pEl = document.getElementById(pId);
    const wEl = document.getElementById(wId);
    if (pEl && wEl && pEl !== wEl) {
      pEl.addEventListener('input', () => { wEl.value = pEl.value; });
      wEl.addEventListener('input', () => { pEl.value = wEl.value; });
      pEl.addEventListener('change', () => { wEl.value = pEl.value; });
      wEl.addEventListener('change', () => { pEl.value = wEl.value; });
    }
  });
}

async function evaluateWizardProgress() {
  try {
    const res = await fetch('/api/system/setup-status');
    const data = await res.json();
    
    let completedSteps = 0;
    // Step 1: Has Chrome Profile
    if (data.hasChromeProfile) {
      wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 2);
      completedSteps++;
    }
    // Step 2: Has CV & Profile Info
    if (data.resumeExists && data.hasProfile) {
      wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 3);
      completedSteps++;
    }
    // Step 3: Has Keywords Configured
    if (data.hasJobs) {
      wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 4);
      completedSteps++;
    }
    if (data.isSetupComplete) {
      completedSteps = 4;
    }

    const readinessText = document.getElementById('readinessScoreText');
    const progressBar = document.getElementById('wizardProgressBar');
    if (readinessText) {
      readinessText.textContent = `SETUP: ${completedSteps}/4 COMPLETE`;
      if (completedSteps === 4) {
        readinessText.className = 'font-mono font-bold text-success';
      } else {
        readinessText.className = 'font-mono font-bold text-accent';
      }
    }
    if (progressBar) {
      const pct = Math.max(15, (completedSteps / 4) * 100);
      progressBar.style.width = `${pct}%`;
    }
  } catch (_) {}
  
  updateWizardTabStyles();
}

function updateWizardTabStyles() {
  for (let i = 1; i <= 4; i++) {
    const tab = document.getElementById(`stepTab${i}`);
    if (!tab) continue;
    const numBadge = tab.querySelector('.step-num-badge') || tab.querySelector('span:first-child');
    
    if (i === wizardCurrentStep) {
      tab.className = 'wizard-step-tab py-2.5 px-3 rounded-sm-neu neu-pressed text-accent font-bold flex items-center justify-center gap-2 cursor-pointer transition';
      if (numBadge) {
        numBadge.className = 'step-num-badge w-5 h-5 rounded-full-neu neu-accent text-white text-[10px] flex items-center justify-center font-bold shrink-0';
        numBadge.textContent = `${i}`;
      }
    } else if (i <= wizardMaxUnlockedStep) {
      tab.className = 'wizard-step-tab py-2.5 px-3 rounded-sm-neu neu-raised-sm text-text-primary hover:text-accent flex items-center justify-center gap-2 cursor-pointer transition';
      if (numBadge) {
        numBadge.className = 'step-num-badge w-5 h-5 rounded-full-neu bg-success/20 text-success text-[10px] flex items-center justify-center font-bold shrink-0';
        numBadge.textContent = '✓';
      }
    } else {
      tab.className = 'wizard-step-tab py-2.5 px-3 rounded-sm-neu text-text-muted opacity-50 flex items-center justify-center gap-2 cursor-not-allowed select-none';
      if (numBadge) {
        numBadge.className = 'step-num-badge w-5 h-5 rounded-full-neu neu-pressed text-[10px] flex items-center justify-center text-text-muted shrink-0';
        numBadge.textContent = `${i}`;
      }
    }
  }
}

async function openSetupWizard(startStep = 1) {
  // 1. Switch to Profile Tab
  const profileTabBtn = document.querySelector('.tab-btn[data-tab="tab-profile"]');
  if (profileTabBtn) {
    profileTabBtn.click();
  }

  // 2. Set view mode to guided
  setProfileViewMode('guided');

  // 3. Evaluate progress and safe start step
  await evaluateWizardProgress();
  const safeStart = Math.min(startStep, wizardMaxUnlockedStep);
  goToWizardStep(safeStart);
  loadWizardProfiles();
  loadWizardCvFields();
  loadWizardJobs();
  verifyAllLogins(false);

  // 4. Smooth scroll to profile tab container
  const target = document.getElementById('tab-profile');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function closeSetupWizard() {
  if (setupWizardModal) {
    setupWizardModal.classList.add('hidden');
  }
}

if (btnOpenSetupWizard) btnOpenSetupWizard.addEventListener('click', () => openSetupWizard(1));
if (btnCloseWizard) btnCloseWizard.addEventListener('click', closeSetupWizard);

function goToWizardStep(stepNum) {
  if (profileViewMode === 'full') {
    setProfileViewMode('guided');
  }

  // STRICT NON-SKIPPABLE GUARD: Cannot skip ahead
  if (stepNum > wizardMaxUnlockedStep) {
    if (stepNum === 2) {
      alert('⚠️ Step 1 Required:\nPlease select your Google Chrome profile in Step 1 first.');
    } else if (stepNum === 3) {
      alert('⚠️ Step 2 Required:\nPlease upload your CV / resume and fill in your Name and Email in Step 2 first.');
    } else if (stepNum === 4) {
      alert('⚠️ Step 3 Required:\nPlease configure your target job titles in Step 3 first.');
    }
    return;
  }

  wizardCurrentStep = stepNum;
  for (let i = 1; i <= 4; i++) {
    const content = document.getElementById(`stepContent${i}`);
    if (content) {
      if (i === stepNum) content.classList.remove('hidden');
      else content.classList.add('hidden');
    }
  }

  updateWizardTabStyles();

  if (stepNum === 1) {
    loadWizardProfiles();
  } else if (stepNum === 2) {
    loadWizardCvFields();
  } else if (stepNum === 3) {
    loadWizardJobs();
    renderWizardKeywords();
  } else if (stepNum === 4) {
    updateStep4ProfileLabel();
    verifyAllLogins(false);
  }
}

// Hook step tab clicks with strict progression checks
for (let i = 1; i <= 4; i++) {
  const tab = document.getElementById(`stepTab${i}`);
  if (tab) {
    tab.addEventListener('click', () => {
      if (i > wizardMaxUnlockedStep) {
        if (i === 2) alert('🔒 Step 2 Locked: Complete Step 1 (Select Chrome Profile) first.');
        else if (i === 3) alert('🔒 Step 3 Locked: Complete Step 2 (Upload CV) first.');
        else if (i === 4) alert('🔒 Step 4 Locked: Complete Step 3 (Target Jobs) first.');
        return;
      }
      goToWizardStep(i);
    });
  }
}

// Step 1: Chrome Profile Detection & Selection
async function loadWizardProfiles() {
  const listEl = document.getElementById('wizProfilesList');
  const setChromeSelect = document.getElementById('setChromeProfile');
  if (!listEl) return;

  try {
    const res = await fetch('/api/system/chrome-profiles');
    const data = await res.json();
    detectedChromeProfiles = data.profiles || [];
    const activeDir = data.currentProfile?.dir || 'Default';

    if (setChromeSelect) {
      setChromeSelect.innerHTML = '';
      detectedChromeProfiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.email || p.id})`;
        if (p.id === activeDir) opt.selected = true;
        setChromeSelect.appendChild(opt);
      });
    }

    listEl.innerHTML = '';
    if (detectedChromeProfiles.length === 0) {
      listEl.innerHTML = '<div class="p-3 neu-pressed rounded-md-neu text-xs text-text-secondary">Default Chrome Profile (Default)</div>';
      return;
    }

    detectedChromeProfiles.forEach(p => {
      const isSelected = p.id === activeDir;
      const card = document.createElement('div');
      card.className = `p-3.5 rounded-md-neu cursor-pointer transition flex items-center justify-between ${isSelected ? 'neu-pressed border-2 border-accent text-text-primary' : 'neu-raised-sm hover:neu-raised text-text-secondary hover:text-text-primary'}`;
      card.innerHTML = `
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full-neu neu-pressed flex items-center justify-center font-bold text-xs text-accent">
            ${(p.name || 'C').charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="font-bold text-xs text-text-primary">${escapeHtml(p.name)}</div>
            <div class="text-[10px] text-text-muted">${escapeHtml(p.email || p.id)}</div>
          </div>
        </div>
        <div class="text-[10px] font-bold px-2.5 py-0.5 rounded-full-neu ${isSelected ? 'neu-accent text-white' : 'neu-raised-sm text-text-secondary'}">
          ${isSelected ? 'ACTIVE' : 'SELECT'}
        </div>
      `;
      card.addEventListener('click', () => {
        selectWizardProfile(p.id, p.name, p.email);
      });
      listEl.appendChild(card);
    });

  } catch (err) {
    listEl.innerHTML = `<div class="p-3 neu-pressed rounded-md-neu text-xs text-danger">Failed to load profiles: ${err.message}</div>`;
  }
}

async function selectWizardProfile(profileId, profileName, profileEmail) {
  const isHeadless = document.getElementById('wizHeadlessToggle')?.checked !== false;
  try {
    await fetch('/api/system/chrome-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, profileName, profileEmail, headless: isHeadless })
    });
    loadWizardProfiles();
  } catch (err) {
    console.error('Failed to save profile:', err);
  }
}

document.getElementById('btnWizStep1Next')?.addEventListener('click', async () => {
  const isHeadless = document.getElementById('wizHeadlessToggle')?.checked !== false;
  const activeProfile = detectedChromeProfiles.find(p => p.id === (document.getElementById('setChromeProfile')?.value || 'Default')) || detectedChromeProfiles[0];
  if (!activeProfile) {
    alert('⚠️ Chrome Profile Required:\n\nPlease select your Google Chrome profile in Step 1 before continuing.');
    return;
  }
  await selectWizardProfile(activeProfile.id, activeProfile.name, activeProfile.email);
  wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 2);
  updateWizardTabStyles();
  goToWizardStep(2);
});

// Step 2: CV PDF Upload & Candidate Profile
function loadWizardCvFields() {
  if (currentProfile?.personal) {
    const p = currentProfile.personal;
    if (document.getElementById('wizFullName')) document.getElementById('wizFullName').value = p.fullName || '';
    if (document.getElementById('wizEmail')) document.getElementById('wizEmail').value = p.email || '';
    if (document.getElementById('wizPhone')) document.getElementById('wizPhone').value = p.phone || '';
    if (document.getElementById('wizLocation')) document.getElementById('wizLocation').value = p.address?.city ? `${p.address.city}, ${p.address.country || ''}` : '';
    if (document.getElementById('wizLinkedin')) document.getElementById('wizLinkedin').value = p.links?.linkedin || '';
    if (document.getElementById('wizGithub')) document.getElementById('wizGithub').value = p.links?.github || '';
  }
  if (currentProfile?.workAuthorization) {
    if (document.getElementById('wizAuthorized')) document.getElementById('wizAuthorized').value = currentProfile.workAuthorization.legallyAuthorized || 'Yes';
    if (document.getElementById('wizSponsorship')) document.getElementById('wizSponsorship').value = currentProfile.workAuthorization.requireSponsorship || 'No';
  }
}

// Drag & drop dropzone
const wizDropzone = document.getElementById('wizDropzone');
const wizFileInput = document.getElementById('wizFileInput');
const tabResumeFileInput = document.getElementById('tabResumeFileInput');

if (wizDropzone) {
  wizDropzone.addEventListener('click', () => wizFileInput?.click());
  wizDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    wizDropzone.classList.add('border-ember', 'bg-carbon');
  });
  wizDropzone.addEventListener('dragleave', () => {
    wizDropzone.classList.remove('border-ember', 'bg-carbon');
  });
  wizDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    wizDropzone.classList.remove('border-ember', 'bg-carbon');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleCvUpload(e.dataTransfer.files[0]);
    }
  });
}

if (wizFileInput) {
  wizFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleCvUpload(e.target.files[0]);
    }
  });
}

if (tabResumeFileInput) {
  tabResumeFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleCvUpload(e.target.files[0]);
    }
  });
}

async function handleCvUpload(file) {
  const statusEl = document.getElementById('wizUploadStatus');
  const badgeEl = document.getElementById('tabResumeStatusBadge');

  if (statusEl) {
    statusEl.innerHTML = `<span class="inline-flex items-center gap-1.5 text-ember">
      <svg class="w-3.5 h-3.5 animate-spin fill-current inline-block" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
      <span>Analyzing CV profile &amp; extracting target job titles...</span>
    </span>`;
  }
  if (badgeEl) badgeEl.textContent = 'ANALYZING PROFILE...';

  try {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      const res = await fetch('/api/resume/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64 })
      });
      const data = await res.json();
      if (data.success) {
        const titles = data.result?.generatedJobTitles || [];
        if (statusEl) {
          statusEl.textContent = `✓ Resume uploaded successfully. Parsed ${data.result.extracted?.skills?.length || 0} skills.`;
          statusEl.className = 'text-[11px] text-emerald-400 font-bold pt-1';
        }
        if (badgeEl) {
          badgeEl.textContent = 'UPLOADED & ACTIVE';
          badgeEl.className = 'text-[10px] px-2 py-0.5 rounded-[2px] font-bold border border-emerald-500 bg-void text-emerald-400 uppercase';
        }

        // Automatically populate Step 3 keywords with generated titles
        if (titles.length > 0) {
          wizardKeywords = [...titles];
          renderWizardKeywords();
        }

        await loadProfile();
        loadWizardCvFields();
        wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 3);
        updateWizardTabStyles();

        // Immediately update credit badge
        if (typeof data.credits === 'number') {
          currentCredits = data.credits;
          renderCreditBadge(currentCredits);
        } else {
          await fetchAndUpdateCredits();
        }
      } else {
        if (statusEl) statusEl.textContent = `✗ Error: ${data.error || 'Upload failed'}`;
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    if (statusEl) statusEl.textContent = `✗ Error: ${err.message}`;
  }
}

document.getElementById('btnWizStep2Back')?.addEventListener('click', () => goToWizardStep(1));
document.getElementById('btnWizStep2Next')?.addEventListener('click', async () => {
  const fullName = document.getElementById('profFullName')?.value?.trim() || document.getElementById('wizFullName')?.value?.trim();
  const email = document.getElementById('profEmail')?.value?.trim() || document.getElementById('wizEmail')?.value?.trim();

  if (!fullName || !email) {
    alert('⚠️ CV & Profile Incomplete:\n\nPlease upload your CV PDF or fill in your Full Legal Name and Primary Email to continue.');
    return;
  }

  // Save form fields to profile
  if (!currentProfile.personal) currentProfile.personal = {};
  if (!currentProfile.workAuthorization) currentProfile.workAuthorization = {};
  if (!currentProfile.personal.links) currentProfile.personal.links = {};
  if (!currentProfile.personal.address) currentProfile.personal.address = {};

  currentProfile.personal.fullName = fullName;
  currentProfile.personal.email = email;
  currentProfile.personal.phone = document.getElementById('profPhone')?.value || document.getElementById('wizPhone')?.value || currentProfile.personal.phone;
  currentProfile.personal.links.linkedin = document.getElementById('profLinkedin')?.value || document.getElementById('wizLinkedin')?.value || currentProfile.personal.links.linkedin;
  currentProfile.personal.links.github = document.getElementById('profGithub')?.value || document.getElementById('wizGithub')?.value || currentProfile.personal.links.github;
  currentProfile.workAuthorization.legallyAuthorized = document.getElementById('profAuthorized')?.value || document.getElementById('wizAuthorized')?.value || 'Yes';
  currentProfile.workAuthorization.requireSponsorship = document.getElementById('profSponsorship')?.value || document.getElementById('wizSponsorship')?.value || 'No';

  const locStr = document.getElementById('profLocation')?.value || document.getElementById('wizLocation')?.value || '';
  if (locStr.includes(',')) {
    const parts = locStr.split(',');
    currentProfile.personal.address.city = parts[0].trim();
    currentProfile.personal.address.country = parts.slice(1).join(',').trim();
  } else if (locStr) {
    currentProfile.personal.address.city = locStr.trim();
  }

  if (document.getElementById('profCity')?.value) {
    currentProfile.personal.address.city = document.getElementById('profCity').value;
  }
  if (document.getElementById('profCountry')?.value) {
    currentProfile.personal.address.country = document.getElementById('profCountry').value;
  }

  if (document.getElementById('profSalaryNumeric')?.value) {
    if (!currentProfile.compensationAndAvailability) currentProfile.compensationAndAvailability = {};
    currentProfile.compensationAndAvailability.desiredSalaryNumeric = Number(document.getElementById('profSalaryNumeric').value);
  }
  if (document.getElementById('profNoticeWeeks')?.value) {
    if (!currentProfile.compensationAndAvailability) currentProfile.compensationAndAvailability = {};
    currentProfile.compensationAndAvailability.noticePeriodWeeks = Number(document.getElementById('profNoticeWeeks').value);
  }

  await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentProfile)
  });

  wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 3);
  await evaluateWizardProgress();
  goToWizardStep(3);
});

// Step 3: Target Jobs to Search & Apply
function loadWizardJobs() {
  wizardKeywords = currentSettings.search?.keywords && currentSettings.search.keywords.length > 0
    ? [...currentSettings.search.keywords] 
    : [];
  renderWizardKeywords();

  if (document.getElementById('wizSearchLocation')) {
    document.getElementById('wizSearchLocation').value = currentSettings.search?.location || 'Worldwide';
  }
  if (document.getElementById('wizWorkplaceType')) {
    document.getElementById('wizWorkplaceType').value = currentSettings.search?.workplaceType || 'remote';
  }
  if (document.getElementById('wizDailyLimit')) {
    document.getElementById('wizDailyLimit').value = currentSettings.execution?.dailyApplicationLimit || 100;
  }
  if (document.getElementById('wizExecutionMode')) {
    document.getElementById('wizExecutionMode').value = currentSettings.execution?.mode || 'autonomous';
  }
}

function renderWizardKeywords() {
  const container = document.getElementById('wizKeywordsTags');
  const countEl = document.getElementById('wizKeywordsCount');
  if (!container) return;
  container.innerHTML = '';
  
  if (countEl) {
    countEl.textContent = `${wizardKeywords.length} titles`;
    countEl.className = 'font-mono text-[11px] text-accent font-semibold px-2 py-0.5 rounded-full-neu neu-pressed';
  }

  if (wizardKeywords.length === 0) {
    container.innerHTML = '<span class="text-text-muted text-[11px]">// No job titles specified yet. Upload your CV in Step 2 or click "• Refresh from CV" above.</span>';
    return;
  }

  wizardKeywords.forEach((kw, index) => {
    const tag = document.createElement('span');
    tag.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full-neu neu-raised-sm text-text-primary text-xs font-semibold';
    tag.innerHTML = `
      <span>${escapeHtml(kw)}</span>
      <button type="button" class="text-text-muted hover:text-accent cursor-pointer font-bold ml-1 text-sm leading-none" data-index="${index}">&times;</button>
    `;
    tag.querySelector('button').addEventListener('click', () => {
      wizardKeywords.splice(index, 1);
      renderWizardKeywords();
    });
    container.appendChild(tag);
  });
}

async function generateGroqTitlesFromResume() {
  const btn = document.getElementById('btnGenerateGroqTitles');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin fill-current inline-block mr-1" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> <span>Refreshing job titles...</span>`;
  }

  try {
    const res = await fetch('/api/resume/generate-titles', { method: 'POST' });
    const data = await res.json();
    if (data.success && Array.isArray(data.titles) && data.titles.length > 0) {
      wizardKeywords = [...data.titles];
      renderWizardKeywords();
      if (typeof data.credits === 'number') {
        currentCredits = data.credits;
        renderCreditBadge(currentCredits);
      } else {
        await fetchAndUpdateCredits();
      }
      alert(`✓ Extracted and added ${data.titles.length} matching job titles from your CV.`);
    } else {
      alert('⚠️ Could not extract titles. Please ensure your CV is uploaded in Step 2.');
    }
  } catch (err) {
    console.error('Job titles error:', err);
    alert(`Error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function addWizardKeyword(kw) {
  if (!kw) return;
  const clean = kw.trim();
  if (clean && !wizardKeywords.includes(clean)) {
    wizardKeywords.push(clean);
    renderWizardKeywords();
  }
}

document.getElementById('btnWizAddKeyword')?.addEventListener('click', () => {
  const input = document.getElementById('wizKeywordInput');
  if (input && input.value) {
    addWizardKeyword(input.value);
    input.value = '';
  }
});

document.getElementById('wizKeywordInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.target.value) {
      addWizardKeyword(e.target.value);
      e.target.value = '';
    }
  }
});

// Quick Presets
document.querySelectorAll('.wiz-preset-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const role = btn.getAttribute('data-role');
    const presets = {
      ai: ['AI Engineer', 'Generative AI Engineer', 'Machine Learning Engineer', 'LLM Engineer', 'AI Agent Developer'],
      fullstack: ['Full Stack Engineer', 'Full Stack Developer', 'Software Engineer', 'React Developer', 'TypeScript Engineer'],
      python: ['Python Developer', 'Python Engineer', 'Backend Engineer', 'FastAPI Developer'],
      data: ['Data Scientist', 'Machine Learning Engineer', 'Data Engineer', 'NLP Engineer']
    };
    (presets[role] || []).forEach(addWizardKeyword);
  });
});

document.querySelectorAll('.kw-preset-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const role = btn.getAttribute('data-preset');
    const presets = {
      ai: ['AI Engineer', 'Generative AI Engineer', 'Machine Learning Engineer'],
      fullstack: ['Full Stack Engineer', 'Software Engineer', 'React Developer'],
      python: ['Python Engineer', 'Backend Engineer', 'FastAPI Developer'],
      datascience: ['Data Scientist', 'Machine Learning Engineer']
    };
    const textarea = document.getElementById('setKeywords');
    if (textarea) {
      const existing = textarea.value.split(',').map(s=>s.trim()).filter(Boolean);
      (presets[role] || []).forEach(p => { if (!existing.includes(p)) existing.push(p); });
      textarea.value = existing.join(', ');
    }
  });
});

document.getElementById('btnWizStep3Back')?.addEventListener('click', () => goToWizardStep(2));
document.getElementById('btnWizStep3Next')?.addEventListener('click', async () => {
  if (!wizardKeywords || wizardKeywords.length === 0) {
    alert('⚠️ No Job Titles Configured:\n\nPlease add at least 1 job keyword, or click "⚡ Refresh Job Titles from CV" to auto-populate titles.');
    return;
  }

  currentSettings.search.keywords = [...wizardKeywords];
  currentSettings.search.location = document.getElementById('wizSearchLocation')?.value || 'Worldwide';
  currentSettings.search.workplaceType = document.getElementById('wizWorkplaceType')?.value || 'remote';
  currentSettings.search.remoteOnly = (currentSettings.search.workplaceType === 'remote');
  currentSettings.execution.dailyApplicationLimit = Number(document.getElementById('wizDailyLimit')?.value) || 100;
  currentSettings.execution.mode = document.getElementById('wizExecutionMode')?.value || 'autonomous';
  currentSettings.execution.easyApplyMode = currentSettings.execution.mode;
  currentSettings.execution.externalMode = currentSettings.execution.mode;

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentSettings)
  });

  wizardMaxUnlockedStep = Math.max(wizardMaxUnlockedStep, 4);
  updateWizardTabStyles();
  goToWizardStep(4);
});

// Step 4: Platform Logins
const platformLoginUrls = {
  linkedin: 'https://www.linkedin.com/login',
  wellfound: 'https://wellfound.com/login',
  ycombinator: 'https://www.workatastartup.com/',
  otta: 'https://app.otta.com/login'
};

function updateStep4ProfileLabel() {
  const label = document.getElementById('wizActiveProfileLabel');
  if (!label) return;
  const activeProfile = currentSettings?.execution?.chromeProfile;
  if (activeProfile && activeProfile.name) {
    label.textContent = `${activeProfile.name} (${activeProfile.email || activeProfile.dir || 'Default'})`;
  } else {
    label.textContent = 'Default Profile';
  }
}

async function openPlatformLogin(platform) {
  const btn = document.getElementById(`btnOpenLogin${platform.charAt(0).toUpperCase() + platform.slice(1)}`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin fill-current inline-block mr-1" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> <span>Opening Chrome...</span>`;
  }

  const targetUrl = platformLoginUrls[platform] || 'https://www.linkedin.com/login';

  try {
    const res = await fetch('/api/system/open-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const data = await res.json();
    
    // Auto-probe logins after 2.5s
    setTimeout(() => {
      verifyAllLogins(false);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }, 2500);
  } catch (err) {
    console.error('Failed to open Chrome for login:', err);
    try { window.open(targetUrl, '_blank'); } catch (_) {}
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function confirmPlatformLogin(platform, confirmed = true) {
  try {
    const res = await fetch('/api/system/confirm-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, confirmed })
    });
    const data = await res.json();
    if (data.success) {
      await verifyAllLogins(false);
    }
  } catch (err) {
    console.error('Failed to confirm login:', err);
  }
}

async function verifyAllLogins(isFromUser = false) {
  const badgeIn = document.getElementById('wizBadgeLinkedin');
  const dotIn = document.getElementById('wizDotLinkedin');
  const badgeWf = document.getElementById('wizBadgeWellfound');
  const dotWf = document.getElementById('wizDotWellfound');
  const badgeYc = document.getElementById('wizBadgeYc');
  const dotYc = document.getElementById('wizDotYc');
  const badgeOt = document.getElementById('wizBadgeOtta');
  const dotOt = document.getElementById('wizDotOtta');

  if (badgeIn) badgeIn.textContent = 'CHECKING...';

  try {
    const res = await fetch('/api/system/verify-logins');
    const data = await res.json();

    // LinkedIn
    if (badgeIn && dotIn) {
      if (data.linkedin) {
        badgeIn.textContent = '✓ LOGGED IN';
        badgeIn.className = 'text-[10px] text-emerald-400 font-bold';
        dotIn.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
      } else {
        badgeIn.textContent = 'NOT LOGGED IN';
        badgeIn.className = 'text-[10px] text-rose-400 font-bold';
        dotIn.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
      }
    }

    // Wellfound
    if (badgeWf && dotWf) {
      if (data.wellfound) {
        badgeWf.textContent = '✓ LOGGED IN';
        badgeWf.className = 'text-[10px] text-emerald-400 font-bold';
        dotWf.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
      } else {
        badgeWf.textContent = 'NOT LOGGED IN';
        badgeWf.className = 'text-[10px] text-steel';
        dotWf.className = 'w-2.5 h-2.5 rounded-full bg-steel';
      }
    }

    // YC
    if (badgeYc && dotYc) {
      if (data.ycombinator) {
        badgeYc.textContent = '✓ LOGGED IN';
        badgeYc.className = 'text-[10px] text-emerald-400 font-bold';
        dotYc.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
      } else {
        badgeYc.textContent = 'OPTIONAL';
        badgeYc.className = 'text-[10px] text-steel';
        dotYc.className = 'w-2.5 h-2.5 rounded-full bg-steel';
      }
    }

    // Otta
    if (badgeOt && dotOt) {
      if (data.otta) {
        badgeOt.textContent = '✓ LOGGED IN';
        badgeOt.className = 'text-[10px] text-emerald-400 font-bold';
        dotOt.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
      } else {
        badgeOt.textContent = 'OPTIONAL';
        badgeOt.className = 'text-[10px] text-steel';
        dotOt.className = 'w-2.5 h-2.5 rounded-full bg-steel';
      }
    }

    if (isFromUser) {
      if (data.linkedin) {
        alert('✓ Verification Success: Active LinkedIn session verified for your selected Chrome profile!');
      } else {
        alert('⚠️ Notice: LinkedIn session was not found.\n\n• If you are already logged in on this computer, click "✓ Already Logged In? Confirm" on the LinkedIn card to accept your session immediately!\n• Or click "Open Chrome to Login" to log in.');
      }
    }
  } catch (err) {
    console.error('Failed to verify logins:', err);
  }
}

document.getElementById('btnWizStep4Back')?.addEventListener('click', () => goToWizardStep(3));
document.getElementById('btnWizFinish')?.addEventListener('click', async () => {
  closeSetupWizard();
  alert('🚀 Setup complete! Your profile, job targeting criteria, and Chrome session have been verified. You can now start automation!');
  await loadSettings();
  await loadProfile();
  await evaluateWizardProgress();
  // Switch to Direct ATS tab
  document.querySelector('.tab-btn[data-tab="tab-direct-jobs"]')?.click();
});

// View current resume button
document.getElementById('btnViewCurrentResume')?.addEventListener('click', () => {
  window.open('/assets/resume.pdf', '_blank');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREDIT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

let currentCredits = null; // cached balance

async function fetchAndUpdateCredits() {
  try {
    const res = await fetch('/api/credits/balance');
    const data = await res.json();
    currentCredits = typeof data.credits === 'number' ? data.credits : 0;
    renderCreditBadge(currentCredits);
    return currentCredits;
  } catch (_) {
    renderCreditBadge(null);
    return null;
  }
}

function renderCreditBadge(credits) {
  const badge = document.getElementById('creditBadgeText');
  const modalBalance = document.getElementById('modalCreditBalance');
  const bar = document.getElementById('creditProgressBar');
  if (!badge) return;

  if (credits === null) {
    badge.textContent = '-- Credits';
    if (modalBalance) modalBalance.textContent = '--  ⚡';
    return;
  }

  badge.textContent = `${credits} Credits`;
  if (modalBalance) modalBalance.textContent = `${credits} ⚡`;

  // Progress bar: treat 100 credits = full
  if (bar) {
    const pct = Math.min(100, Math.round((credits / 100) * 100));
    bar.style.width = `${pct}%`;
    bar.className = `h-full transition-all duration-500 rounded-full ${
      credits > 20 ? 'bg-amber-500' : credits > 5 ? 'bg-orange-500' : 'bg-red-500'
    }`;
  }

  // Turn badge red when low
  const btn = document.getElementById('creditBadgeBtn');
  if (btn) {
    if (credits <= 3) {
      btn.className = btn.className.replace('border-amber-600/50 text-amber-400', 'border-red-600/60 text-red-400 animate-pulse');
    }
  }
}

function openPricingModal() {
  const modal = document.getElementById('pricingModal');
  if (modal) {
    modal.classList.remove('hidden');
    fetchAndUpdateCredits(); // refresh balance when modal opens
  }
}

function closePricingModal() {
  const modal = document.getElementById('pricingModal');
  if (modal) modal.classList.add('hidden');
}

// Close modal on backdrop click
document.getElementById('pricingModal')?.addEventListener('click', function(e) {
  if (e.target === this) closePricingModal();
});

async function redeemPromoCode() {
  const input = document.getElementById('promoCodeInput');
  const feedback = document.getElementById('promoFeedback');
  const btn = document.getElementById('promoRedeemBtn');
  if (!input || !feedback || !btn) return;

  const code = input.value.trim().toUpperCase();
  if (!code) {
    showPromoFeedback('Please enter a promo code', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Applying...';
  feedback.classList.add('hidden');

  try {
    const res = await fetch('/api/credits/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (data.success) {
      showPromoFeedback(`✅ ${data.message}`, 'success');
      input.value = '';
      currentCredits = data.credits;
      renderCreditBadge(currentCredits);
    } else {
      showPromoFeedback(`❌ ${data.message}`, 'error');
    }
  } catch (e) {
    showPromoFeedback('❌ Network error. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Code';
  }
}

function showPromoFeedback(msg, type) {
  const el = document.getElementById('promoFeedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `mt-2 text-xs font-medium px-3 py-2 rounded-[2px] border ${
    type === 'success'
      ? 'text-green-400 bg-green-900/20 border-green-700/40'
      : 'text-red-400 bg-red-900/20 border-red-700/40'
  }`;
  el.classList.remove('hidden');
  // Auto-hide after 5s
  setTimeout(() => el.classList.add('hidden'), 5000);
}

/**
 * Pre-automation credit check.
 * Returns true if OK to proceed, false if user should be warned or blocked.
 * Pass targetCount = estimated number of AI-tailored applications in this run.
 */
async function checkCreditsBeforeRun(targetCount = 1) {
  const credits = await fetchAndUpdateCredits();
  if (credits === null) return true; // gateway unreachable, let run proceed (server will guard)

  if (credits <= 0) {
    alert(
      `⚡ No Credits Remaining\n\n` +
      `You have 0 AI credits remaining.\n\n` +
      `Applications cannot proceed without credits. Please redeem a promo code or top up your balance in the Credits modal.`
    );
    openPricingModal();
    return false;
  }

  const costPerApp = 5;
  const neededCredits = targetCount * costPerApp;
  if (credits < neededCredits) {
    const fullAppsPossible = Math.floor(credits / costPerApp);
    const proceed = confirm(
      `⚡ Limited Credits Warning\n\n` +
      `You have ${credits} credit${credits !== 1 ? 's' : ''} remaining.\n` +
      `Targeting ${targetCount} applications requires ${neededCredits} credits (5 credits/application).\n\n` +
      `The automation can only submit ~${fullAppsPossible} job${fullAppsPossible !== 1 ? 's' : ''} before running out of credits.\n\n` +
      `Click OK to proceed with available credits, or Cancel to top up.`
    );
    if (!proceed) {
      openPricingModal();
      return false;
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════

// Check if first-time setup is needed on load
async function checkFirstTimeSetup() {
  try {
    const res = await fetch('/api/system/setup-status');
    const data = await res.json();
    if (!data.isSetupComplete) {
      console.log('Setup incomplete, opening Onboarding Wizard...');
      setTimeout(() => openSetupWizard(1), 600);
    }
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  checkFirstTimeSetup();
  fetchAndUpdateCredits(); // load credit balance on startup
});

// ═══════════════════════════════════════════════════════════════════════════
// DIRECT ATS JOBS & 1-CLICK AUTOMATIC APPLY (WITH 3-AI MODEL ADVISORY)
// ═══════════════════════════════════════════════════════════════════════════

let allAtsJobs = [];
let selectedAtsJob = null;
let currentAtsFilter = 'all';
let showAppliedOnly = false;
let currentOutreachTab = 'em'; // 'em' or 'founder'

// DOM Elements
const atsJobTotalBadge = document.getElementById('atsJobTotalBadge');
const atsSearchInput = document.getElementById('atsSearchInput');
const atsListCount = document.getElementById('atsListCount');
const atsJobsList = document.getElementById('atsJobsList');
const atsEmptyInspector = document.getElementById('atsEmptyInspector');
const atsActiveInspector = document.getElementById('atsActiveInspector');

const inspPlatformBadge = document.getElementById('inspPlatformBadge');
const inspStatusBadge = document.getElementById('inspStatusBadge');
const inspJobTitle = document.getElementById('inspJobTitle');
const inspCompany = document.getElementById('inspCompany');
const inspLocation = document.getElementById('inspLocation');
const inspExternalLink = document.getElementById('inspExternalLink');
const btnInspApply = document.getElementById('btnInspApply');
const inspApplyText = document.getElementById('inspApplyText');

// 3-AI Advisory Elements
const aiScoreCircle = document.getElementById('aiScoreCircle');
const aiConsensusScore = document.getElementById('aiConsensusScore');
const aiVerdictBadge = document.getElementById('aiVerdictBadge');
const aiVerdictText = document.getElementById('aiVerdictText');
const btnReanalyzeAi = document.getElementById('btnReanalyzeAi');
const btnReanalyzeAiText = document.getElementById('btnReanalyzeAiText');

const qwenScoreBadge = document.getElementById('qwenScoreBadge');
const qwenVerdict = document.getElementById('qwenVerdict');
const qwenReason = document.getElementById('qwenReason');

const gpt20ScoreBadge = document.getElementById('gpt20ScoreBadge');
const gpt20Verdict = document.getElementById('gpt20Verdict');
const gpt20Reason = document.getElementById('gpt20Reason');

const gpt120ScoreBadge = document.getElementById('gpt120ScoreBadge');
const gpt120Verdict = document.getElementById('gpt120Verdict');
const gpt120Reason = document.getElementById('gpt120Reason');

// Beautified JD Elements
const jdOverviewText = document.getElementById('jdOverviewText');
const jdTechStackChips = document.getElementById('jdTechStackChips');
const jdSkillCountBadge = document.getElementById('jdSkillCountBadge');
const jdBulletsContainer = document.getElementById('jdBulletsContainer');
const jdBulletsList = document.getElementById('jdBulletsList');
const inspJobDesc = document.getElementById('inspJobDesc');
const btnToggleFullJd = document.getElementById('btnToggleFullJd');

// Step 2 Cold Outreach Elements
const btnTabOutreachEM = document.getElementById('btnTabOutreachEM');
const btnTabOutreachFounder = document.getElementById('btnTabOutreachFounder');
const outreachNoteText = document.getElementById('outreachNoteText');
const btnCopyOutreachNote = document.getElementById('btnCopyOutreachNote');
const copyNoteBtnText = document.getElementById('copyNoteBtnText');
const btnSearchLinkedIn = document.getElementById('btnSearchLinkedIn');
const btnSearchTwitter = document.getElementById('btnSearchTwitter');
const btnRefreshAtsJobs = document.getElementById('btnRefreshAtsJobs');
const cvTailoredTargetTitle = document.getElementById('cvTailoredTargetTitle');
const cvTailorStatusChip = document.getElementById('cvTailorStatusChip');
const btnRefreshAtsJobsText = document.getElementById('btnRefreshAtsJobsText');

async function loadDirectAtsJobs() {
  try {
    const res = await fetch('/api/ats/jobs');
    const data = await res.json();
    allAtsJobs = data.jobs || [];

    if (atsJobTotalBadge) {
      atsJobTotalBadge.innerText = `${allAtsJobs.length} ROLES`;
    }

    renderAtsJobList();

    // Auto-select first job if none selected
    if (!selectedAtsJob && allAtsJobs.length > 0) {
      selectAtsJob(allAtsJobs[0]);
    }
  } catch (err) {
    console.error('Failed to load ATS jobs:', err);
    if (atsJobsList) {
      atsJobsList.innerHTML = `<div class="p-6 text-center text-rose-400 text-xs">Error loading roles: ${err.message}</div>`;
    }
  }
}

function renderAtsJobList() {
  if (!atsJobsList) return;

  const query = (atsSearchInput?.value || '').toLowerCase().trim();
  const filtered = allAtsJobs.filter(j => {
    const isApplied = j.status === 'applied' || j.status === 'previously_applied' || j.isApplied === true;

    // RULE 1: If NOT showing applied, HIDE all applied jobs!
    if (!showAppliedOnly && isApplied) {
      return false;
    }

    // RULE 2: If showing applied, SHOW ONLY applied jobs!
    if (showAppliedOnly) {
      if (!isApplied) return false;
    }

    // RULE 3: Multi-Platform filtering
    const p = (j.platform || '').toLowerCase();
    if (currentAtsFilter === 'ashby' && p !== 'ashby') return false;
    if (currentAtsFilter === 'greenhouse' && p !== 'greenhouse') return false;
    if (currentAtsFilter === 'lever' && p !== 'lever') return false;
    if (currentAtsFilter === 'hackernews' && p !== 'hackernews' && p !== 'hn') return false;
    if (currentAtsFilter === 'wellfound' && p !== 'wellfound') return false;
    if (currentAtsFilter === 'ycombinator' && p !== 'ycombinator' && p !== 'yc' && p !== 'workatastartup') return false;
    if (currentAtsFilter === 'remoteboards' && !['remoteok', 'jobicy', 'weworkremotely', 'remotive', 'remoteboards'].includes(p)) return false;
    if (currentAtsFilter === 'linkedin' && p !== 'linkedin') return false;

    if (query) {
      const target = `${j.title} ${j.company} ${j.location} ${j.description || ''}`.toLowerCase();
      if (!target.includes(query)) return false;
    }
    return true;
  });

  if (atsListCount) {
    atsListCount.innerText = `Showing ${filtered.length} of ${allAtsJobs.length} listings`;
  }

  if (filtered.length === 0) {
    atsJobsList.innerHTML = `
      <div class="p-8 text-center text-text-secondary text-xs neu-raised rounded-md-neu">
        <p class="font-semibold text-text-primary">No active roles in this view.</p>
        <p class="text-text-muted mt-1">Run discovery or click refresh to load fresh opportunities across all platforms.</p>
      </div>
    `;
    return;
  }

  atsJobsList.innerHTML = filtered.map(j => {
    const isSelected = selectedAtsJob && selectedAtsJob.jobId === j.jobId;
    const isApplied = j.status === 'applied';
    const isApplying = j.status === 'applying';

    // Plain inset pill for AI score: cream text, number colored by score
    let aiScorePill = '';
    if (j.aiEvaluation && j.aiEvaluation.consensusScore) {
      const s = j.aiEvaluation.consensusScore;
      const numColor = s >= 7 ? 'text-[#4ade80]' : (s >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]');
      aiScorePill = `<span class="text-[9px] px-2 py-0.5 rounded-full-neu font-mono neu-pressed text-text-primary"><span class="text-text-muted">AI </span><span class="${numColor} font-bold">${s.toFixed(1)}</span><span class="text-text-muted">/10</span></span>`;
    }

    // Softened status indicators
    let statusPill = '<span class="text-[9px] px-2 py-0.5 rounded-full-neu neu-raised-sm text-text-muted font-medium">READY</span>';
    if (isApplied) {
      statusPill = '<span class="text-[9px] px-2 py-0.5 rounded-full-neu neu-pressed bg-[rgba(74,222,128,0.12)] border border-[rgba(74,222,128,0.3)] text-[#4ade80] font-bold">✓ APPLIED</span>';
    } else if (isApplying) {
      statusPill = '<span class="text-[9px] px-2 py-0.5 rounded-full-neu neu-pressed bg-highlight/20 text-highlight font-bold animate-pulse">APPLYING...</span>';
    }

    return `
      <div class="job-card-ats p-2.5 rounded-md-neu transition cursor-pointer ${
        isSelected ? 'neu-pressed border-l-[3px] border-highlight' : 'neu-raised-sm hover:translate-x-0.5 border-l-[3px] border-transparent'
      }" data-job-id="${j.jobId}">
        <div class="flex items-center justify-between gap-2">
          <!-- Level 1: Primary Text (Cream in dark) -->
          <span class="text-xs font-bold text-text-primary truncate max-w-[190px]">${escapeHtml(j.company)}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            ${aiScorePill}
            <span class="text-[9px] px-1.5 py-0.5 rounded-full-neu font-mono uppercase font-medium neu-pressed text-text-muted">
              ${j.platform}
            </span>
            ${statusPill}
          </div>
        </div>
        <!-- Level 2: Secondary Text -->
        <div class="text-xs font-medium text-text-secondary mt-1 leading-snug truncate">
          ${escapeHtml(j.title)}
        </div>
        <!-- Level 3: Muted Text -->
        <div class="flex items-center gap-2 mt-1 text-[11px] text-text-muted font-normal">
          <span>${escapeHtml(j.location || 'Remote')}</span>
          <span>&bull;</span>
          <span class="uppercase font-mono text-[10px]">${j.workplaceType || 'remote'}</span>
        </div>
      </div>
    `;
  }).join('');

  atsJobsList.querySelectorAll('.job-card-ats').forEach(el => {
    el.addEventListener('click', () => {
      const jId = el.getAttribute('data-job-id');
      const found = allAtsJobs.find(x => x.jobId === jId);
      if (found) selectAtsJob(found);
    });
  });
}

async function selectAtsJob(job) {
  selectedAtsJob = job;

  if (atsEmptyInspector) atsEmptyInspector.classList.add('hidden');
  if (atsActiveInspector) atsActiveInspector.classList.remove('hidden');

  if (inspPlatformBadge) {
    inspPlatformBadge.innerText = (job.platform || 'ATS').toUpperCase();
    inspPlatformBadge.className = 'text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full-neu neu-pressed text-accent uppercase';
  }

  const isApplied = job.status === 'applied';
  const isApplying = job.status === 'applying';

  if (inspStatusBadge) {
    if (isApplied) {
      inspStatusBadge.innerText = '✓ APPLIED';
      inspStatusBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-full-neu neu-pressed bg-[rgba(74,222,128,0.12)] border border-[rgba(74,222,128,0.3)] text-[#4ade80] uppercase';
    } else if (isApplying) {
      inspStatusBadge.innerText = 'APPLYING...';
      inspStatusBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-full-neu bg-[#172554] text-white uppercase animate-pulse';
    } else {
      inspStatusBadge.innerText = 'READY TO APPLY';
      inspStatusBadge.className = 'text-[10px] font-semibold px-2.5 py-0.5 rounded-full-neu neu-raised-sm text-text-secondary uppercase';
    }
  }

  if (inspJobTitle) inspJobTitle.innerText = job.title;
  if (inspCompany) inspCompany.innerText = job.company;
  if (inspLocation) inspLocation.innerText = job.location || 'Remote';
  if (inspExternalLink) inspExternalLink.href = job.applyUrl || job.url || '#';

  // Apply Button State
  if (btnInspApply && inspApplyText) {
    if (isApplied) {
      btnInspApply.disabled = true;
      btnInspApply.className = 'px-5 py-2 rounded-[2px] bg-emerald-900/60 border border-emerald-700 text-emerald-300 text-xs font-bold uppercase tracking-wider cursor-not-allowed';
      inspApplyText.innerText = '✓ Applied Successfully';
    } else if (isApplying) {
      btnInspApply.disabled = true;
      btnInspApply.className = 'neu-btn px-6 py-2.5 rounded-md-neu neu-accent opacity-70 text-xs font-bold cursor-wait animate-pulse';
      inspApplyText.innerText = '⏳ Applying in Chrome...';
    } else {
      btnInspApply.disabled = false;
      btnInspApply.className = 'neu-btn px-6 py-2.5 rounded-md-neu neu-accent text-xs font-bold transition cursor-pointer';
      inspApplyText.innerText = '⚡ Apply Automatically';
    }
  }

  renderOutreachNote();
  renderBeautifiedJd(job);

  // Evaluate or render 3-AI consensus
  renderAiConsensus(job);

  // Re-highlight list
  renderAtsJobList();
}

function renderAiConsensus(job) {
  if (!aiConsensusScore) return;

  const evalData = job.aiEvaluation;
  if (evalData && evalData.consensusScore) {
    aiConsensusScore.innerText = evalData.consensusScore.toFixed(1);
    
    // Circle & Badge colors
    const s = evalData.consensusScore;
    const scoreClr = s >= 7 ? 'text-[#4ade80]' : (s >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]');
    aiScoreCircle.className = 'w-14 h-14 rounded-full-neu neu-raised flex flex-col items-center justify-center p-1.5 text-center cursor-pointer hover:opacity-90 transition';
    aiConsensusScore.className = `font-mono font-bold text-base leading-none ${scoreClr}`;

    const verdictBorder = evalData.recommendationTier === 'high' 
      ? 'text-[#4ade80] bg-[rgba(74,222,128,0.12)] border border-[rgba(74,222,128,0.3)]' 
      : (evalData.recommendationTier === 'moderate' 
          ? 'text-[#fbbf24] bg-[rgba(251,191,36,0.12)] border border-[rgba(251,191,36,0.3)]' 
          : 'text-[#f87171] bg-[rgba(248,113,113,0.12)] border border-[rgba(248,113,113,0.3)]');
    aiVerdictBadge.className = `text-[9px] font-bold neu-pressed px-2 py-0.5 rounded-full-neu uppercase mt-0.5 ${verdictBorder}`;
    aiVerdictBadge.innerText = evalData.recommendationTier === 'high' ? 'HIGH RECRUITER ATTENTION' : (evalData.recommendationTier === 'moderate' ? 'GOOD FIT' : 'CAUTION');

    const tailoredTitle = evalData.tailoredCvUsed?.targetTitle || job.title;
    if (aiVerdictText) {
      aiVerdictText.innerText = `${evalData.consensusVerdict || ''} • 3 AI models evaluated ATS CV tailored for ${job.company}`;
    }

    if (cvTailoredTargetTitle) {
      cvTailoredTargetTitle.innerText = ` (${tailoredTitle})`;
    }

    // Model scores: plain inset cards, number colored by score
    function formatModelScore(score) {
      if (!score) return '--/10';
      const c = score >= 7 ? 'text-[#4ade80]' : (score >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]');
      return `<span class="${c} font-bold font-mono text-base">${score}</span><span class="text-text-muted font-mono text-xs">/10</span>`;
    }

    // 1. Qwen
    const qwen = evalData.models?.qwen || {};
    if (qwenScoreBadge) qwenScoreBadge.innerHTML = formatModelScore(qwen.score);
    if (qwenVerdict) qwenVerdict.innerText = qwen.verdict || 'Ready';
    if (qwenReason) qwenReason.innerText = qwen.reason || 'Technical skills match candidate stack.';

    // 2. GPT OSS 20B
    const gpt20 = evalData.models?.gptOss20b || {};
    if (gpt20ScoreBadge) gpt20ScoreBadge.innerHTML = formatModelScore(gpt20.score);
    if (gpt20Verdict) gpt20Verdict.innerText = gpt20.verdict || 'Ready';
    if (gpt20Reason) gpt20Reason.innerText = gpt20.reason || 'Evaluates modern agent & API engineering alignment.';

    // 3. GPT OSS 120B
    const gpt120 = evalData.models?.gptOss120b || {};
    if (gpt120ScoreBadge) gpt120ScoreBadge.innerHTML = formatModelScore(gpt120.score);
    if (gpt120Verdict) gpt120Verdict.innerText = gpt120.verdict || 'Ready';
    if (gpt120Reason) gpt120Reason.innerText = gpt120.reason || 'Interview callback likelihood based on resume experience.';

    // Update modal details if open or ready
    updateAiConsensusModal(job);

  } else {
    // Show evaluating state & fetch from server
    aiConsensusScore.innerText = '...';
    aiScoreCircle.className = 'w-14 h-14 rounded-full-neu neu-raised flex flex-col items-center justify-center p-1.5 text-center cursor-pointer animate-pulse';
    aiVerdictBadge.className = 'px-2 py-0.5 rounded-[2px] text-[10px] font-bold bg-void text-steel border border-iron uppercase';
    aiVerdictBadge.innerText = 'ANALYZING...';
    if (aiVerdictText) {
      aiVerdictText.innerText = `Synthesizing tailored ATS CV for ${job.company} & evaluating across Qwen 27B, GPT OSS 20B, and GPT OSS 120B...`;
    }

    if (qwenVerdict) qwenVerdict.innerText = 'Querying Qwen...';
    if (gpt20Verdict) gpt20Verdict.innerText = 'Querying GPT OSS 20B...';
    if (gpt120Verdict) gpt120Verdict.innerText = 'Querying GPT OSS 120B...';

    // Call server to evaluate
    fetch('/api/ats/evaluate-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.jobId })
    })
      .then(r => r.json())
      .then(data => {
        if (data.evaluation) {
          job.aiEvaluation = data.evaluation;
          if (selectedAtsJob?.jobId === job.jobId) {
            renderAiConsensus(job);
            renderBeautifiedJd(job);
            renderAtsJobList();
            updateAiConsensusModal(job);
          }
        }
      })
      .catch(e => console.warn('AI evaluation error:', e));
  }
}

let currentAiModalFilter = 'all';

function setAiModalFilter(filter = 'all') {
  currentAiModalFilter = filter;

  const cardQwen = document.getElementById('aiModalCardQwen');
  const cardGpt20 = document.getElementById('aiModalCardGpt20');
  const cardGpt120 = document.getElementById('aiModalCardGpt120');
  const consensusBanner = document.getElementById('aiModalConsensusBanner');

  const tabAll = document.getElementById('aiTabBtnAll');
  const tabQwen = document.getElementById('aiTabBtnQwen');
  const tabGpt20 = document.getElementById('aiTabBtnGpt20');
  const tabGpt120 = document.getElementById('aiTabBtnGpt120');

  const tabs = [
    { id: 'all', btn: tabAll },
    { id: 'qwen', btn: tabQwen },
    { id: 'gpt20', btn: tabGpt20 },
    { id: 'gpt120', btn: tabGpt120 }
  ];

  tabs.forEach(t => {
    if (!t.btn) return;
    if (t.id === filter) {
      t.btn.className = 'px-3 py-1 rounded-full-neu neu-raised text-accent font-bold transition';
    } else {
      t.btn.className = 'px-3 py-1 rounded-full-neu text-text-secondary hover:text-text-primary transition';
    }
  });

  if (filter === 'all') {
    if (consensusBanner) consensusBanner.classList.remove('hidden');
    if (cardQwen) cardQwen.classList.remove('hidden');
    if (cardGpt20) cardGpt20.classList.remove('hidden');
    if (cardGpt120) cardGpt120.classList.remove('hidden');
  } else if (filter === 'qwen') {
    if (consensusBanner) consensusBanner.classList.add('hidden');
    if (cardQwen) cardQwen.classList.remove('hidden');
    if (cardGpt20) cardGpt20.classList.add('hidden');
    if (cardGpt120) cardGpt120.classList.add('hidden');
  } else if (filter === 'gpt20') {
    if (consensusBanner) consensusBanner.classList.add('hidden');
    if (cardQwen) cardQwen.classList.add('hidden');
    if (cardGpt20) cardGpt20.classList.remove('hidden');
    if (cardGpt120) cardGpt120.classList.add('hidden');
  } else if (filter === 'gpt120') {
    if (consensusBanner) consensusBanner.classList.add('hidden');
    if (cardQwen) cardQwen.classList.add('hidden');
    if (cardGpt20) cardGpt20.classList.add('hidden');
    if (cardGpt120) cardGpt120.classList.remove('hidden');
  }
}

function updateAiConsensusModal(job) {
  if (!job) job = selectedAtsJob;
  if (!job) return;

  const modal = document.getElementById('aiConsensusModal');
  if (!modal) return;

  const evalData = job.aiEvaluation;
  const titleEl = document.getElementById('aiModalTitle');
  const subEl = document.getElementById('aiModalSubtitle');
  const verdictEl = document.getElementById('aiModalConsensusVerdict');
  const scoreEl = document.getElementById('aiModalScore');

  if (titleEl) titleEl.innerText = `${job.title || 'Role'} • ${job.company || 'Company'}`;
  if (subEl) subEl.innerText = `${job.platform ? job.platform.toUpperCase() : 'ATS'} Direct Role Evaluation`;

  if (evalData && evalData.consensusScore) {
    if (verdictEl) verdictEl.innerText = evalData.consensusVerdict || 'Evaluated by Frontier Models';
    if (scoreEl) {
      scoreEl.innerText = `${evalData.consensusScore.toFixed(1)}/10`;
      const s = evalData.consensusScore;
      scoreEl.className = `text-2xl font-mono font-bold ${s >= 7 ? 'text-[#4ade80]' : (s >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]')}`;
    }

    const qwen = evalData.models?.qwen || {};
    const gpt20 = evalData.models?.gptOss20b || {};
    const gpt120 = evalData.models?.gptOss120b || {};

    const qScoreEl = document.getElementById('aiModalQwenScore');
    const qVerdictEl = document.getElementById('aiModalQwenVerdict');
    const qReasonEl = document.getElementById('aiModalQwenReason');
    if (qScoreEl) qScoreEl.innerText = qwen.score ? `${qwen.score}/10` : '--/10';
    if (qVerdictEl) {
      qVerdictEl.innerText = qwen.verdict || 'Ready';
      qVerdictEl.className = `text-[10px] font-bold px-2 py-0.5 rounded-full-neu neu-pressed ${qwen.score >= 7 ? 'text-[#4ade80]' : (qwen.score >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]')}`;
    }
    if (qReasonEl) qReasonEl.innerText = qwen.reason || 'No detailed reasoning recorded.';

    const g20ScoreEl = document.getElementById('aiModalGpt20Score');
    const g20VerdictEl = document.getElementById('aiModalGpt20Verdict');
    const g20ReasonEl = document.getElementById('aiModalGpt20Reason');
    if (g20ScoreEl) g20ScoreEl.innerText = gpt20.score ? `${gpt20.score}/10` : '--/10';
    if (g20VerdictEl) {
      g20VerdictEl.innerText = gpt20.verdict || 'Ready';
      g20VerdictEl.className = `text-[10px] font-bold px-2 py-0.5 rounded-full-neu neu-pressed ${gpt20.score >= 7 ? 'text-[#4ade80]' : (gpt20.score >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]')}`;
    }
    if (g20ReasonEl) g20ReasonEl.innerText = gpt20.reason || 'No detailed reasoning recorded.';

    const g120ScoreEl = document.getElementById('aiModalGpt120Score');
    const g120VerdictEl = document.getElementById('aiModalGpt120Verdict');
    const g120ReasonEl = document.getElementById('aiModalGpt120Reason');
    if (g120ScoreEl) g120ScoreEl.innerText = gpt120.score ? `${gpt120.score}/10` : '--/10';
    if (g120VerdictEl) {
      g120VerdictEl.innerText = gpt120.verdict || 'Ready';
      g120VerdictEl.className = `text-[10px] font-bold px-2 py-0.5 rounded-full-neu neu-pressed ${gpt120.score >= 7 ? 'text-[#4ade80]' : (gpt120.score >= 4 ? 'text-[#fbbf24]' : 'text-[#f87171]')}`;
    }
    if (g120ReasonEl) g120ReasonEl.innerText = gpt120.reason || 'No detailed reasoning recorded.';

    // Tailored ATS profile summary evaluated by AI
    const tailoredSummaryEl = document.getElementById('aiModalTailoredSummary');
    const tailored = evalData.tailoredCvUsed || {};
    if (tailoredSummaryEl) {
      const summaryText = tailored.tailoredSummary || 'Custom resume profile generated for target role.';
      const targetTitle = tailored.targetTitle ? `Target Title: ${tailored.targetTitle}

` : '';
      tailoredSummaryEl.innerText = `${targetTitle}${summaryText}`;
    }
  } else {
    if (verdictEl) verdictEl.innerText = 'Evaluating match across models...';
    if (scoreEl) scoreEl.innerText = '...';
    const qReasonEl = document.getElementById('aiModalQwenReason');
    if (qReasonEl) qReasonEl.innerText = 'Awaiting model evaluation...';
    const g20ReasonEl = document.getElementById('aiModalGpt20Reason');
    if (g20ReasonEl) g20ReasonEl.innerText = 'Awaiting model evaluation...';
    const g120ReasonEl = document.getElementById('aiModalGpt120Reason');
    if (g120ReasonEl) g120ReasonEl.innerText = 'Awaiting model evaluation...';
  }
}

function openAiConsensusModal(filter = 'all') {
  const modal = document.getElementById('aiConsensusModal');
  if (!modal) return;
  updateAiConsensusModal(selectedAtsJob);
  setAiModalFilter(filter);
  modal.classList.remove('hidden');
}

function closeAiConsensusModal() {
  const modal = document.getElementById('aiConsensusModal');
  if (modal) modal.classList.add('hidden');
}

window.openAiConsensusModal = openAiConsensusModal;
window.setAiModalFilter = setAiModalFilter;
window.closeAiConsensusModal = closeAiConsensusModal;

document.getElementById('aiConsensusModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeAiConsensusModal();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeAiConsensusModal();
  }
});

function formatJobDescriptionHtml(rawDesc) {
  if (!rawDesc) return '<p class="text-ash">// No detailed description provided.</p>';
  
  // Unescape HTML entities
  let text = String(rawDesc)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”');

  // Check if it's HTML (contains HTML tag structure)
  if (/<[a-z][\s\S]*>/i.test(text)) {
    // Strip malicious tags: script, style, iframe, object, embed
    text = text.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Strip inline event attributes like onclick, onload
    text = text.replace(/\s+on\w+="[^"]*"/gi, '').replace(/\s+on\w+='[^']*'/gi, '');
    // Remove unwanted outer wrapper tags like content-intro div without losing content
    text = text.replace(/<\/?(div|span|header|footer|section|article)[^>]*>/gi, '');
    // Ensure links open in new tab with security attributes
    text = text.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*)>/gi, '<a $1href="$2"$3 target="_blank" rel="noopener noreferrer">');
    // Normalize excessive breaks and empty paragraphs
    text = text.replace(/(<br\s*[\/]?>\s*){2,}/gi, '<br/>');
    text = text.replace(/<p>\s*<\/p>/gi, '');
    return text.trim();
  } else {
    // Pure plain text: format into semantic paragraphs and bullet lists
    const paragraphs = text.split(/\n\s*\n/);
    return paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // If paragraph contains bullet lines
      if (/^[•\-\*\u2022\u2023\u25E6\u2043\u2219][ \t]+/m.test(trimmed)) {
        const lines = trimmed.split('\n');
        const items = lines.map(line => {
          const cleanLine = line.replace(/^[ \t]*[•\-\*\u2022\u2023\u25E6\u2043\u2219][ \t]*/, '').trim();
          return cleanLine ? `<li>${escapeHtml(cleanLine)}</li>` : '';
        }).filter(Boolean);
        return `<ul>${items.join('')}</ul>`;
      }
      return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br/>')}</p>`;
    }).join('');
  }
}

function renderBeautifiedJd(job) {
  const bJd = job.aiEvaluation?.beautifiedJd;
  const rawDesc = job.description || '';

  // Overview (clean plain text only)
  if (jdOverviewText) {
    if (bJd && bJd.overview) {
      jdOverviewText.innerText = bJd.overview;
    } else {
      const cleanDesc = String(rawDesc)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const firstLines = cleanDesc.split(/(?<=[.?!])\s+/).slice(0, 3).join(' ');
      jdOverviewText.innerText = firstLines || 'Detailed technical opening at ' + job.company;
    }
  }

  // Tech Stack Chips
  if (jdTechStackChips) {
    const skills = (bJd && bJd.skills && bJd.skills.length > 0) 
      ? bJd.skills 
      : ['Python', 'AI/ML', 'PyTorch', 'LLMs', 'FastAPI', 'Remote'];
    
    if (jdSkillCountBadge) {
      jdSkillCountBadge.innerText = `${skills.length} detected tech skills`;
    }

    jdTechStackChips.innerHTML = skills.map(s => {
      const isShoaibCore = ['Python', 'PyTorch', 'LangChain', 'LangGraph', 'FastAPI', 'Docker', 'RAG', 'LLMs', 'Vector Databases'].some(c => s.toLowerCase().includes(c.toLowerCase()));
      return `<span class="px-2.5 py-1 rounded-[2px] ${isShoaibCore ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300 font-bold' : 'bg-carbon border border-iron text-steel'} text-[11px] font-mono">${isShoaibCore ? '✓ ' : ''}${s}</span>`;
    }).join('');
  }

  // Bullets
  if (jdBulletsContainer && jdBulletsList) {
    if (bJd && bJd.bullets && bJd.bullets.length > 0) {
      jdBulletsContainer.classList.remove('hidden');
      jdBulletsList.innerHTML = bJd.bullets.map(b => `<li class="leading-relaxed">${escapeHtml(b)}</li>`).join('');
    } else {
      jdBulletsContainer.classList.add('hidden');
    }
  }

  // Full Text (Rendered cleanly as sanitized semantic HTML)
  if (inspJobDesc) {
    inspJobDesc.innerHTML = formatJobDescriptionHtml(rawDesc || bJd?.fullText);
  }
}

function renderOutreachNote() {
  if (!selectedAtsJob) return;

  const outreach = selectedAtsJob.outreach || {};
  const note = currentOutreachTab === 'em' 
    ? (outreach.engineeringManagerNote || `Hi [Name], saw the ${selectedAtsJob.title} posting on your careers page and just submitted my application. I've recently built scalable AI systems and multi-agent pipelines with Python and LLM integrations, matching your stack. Looking forward to hopefully connecting with the team!`)
    : (outreach.founderNote || `Hi [Name], love the mission at ${selectedAtsJob.company}—just applied for the ${selectedAtsJob.title} role on your site. I specialize in scalable AI systems and multi-agent pipelines with Python and LLM integrations and would love to help push the product forward. Excited to see the team continue to grow!`);

  if (outreachNoteText) outreachNoteText.innerText = `"${note}"`;

  if (btnSearchLinkedIn) {
    btnSearchLinkedIn.href = outreach.links?.findOnLinkedIn || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(selectedAtsJob.company)}+%28%22Engineering+Manager%22+OR+%22CTO%22+OR+%22Founder%22%29`;
  }
  if (btnSearchTwitter) {
    btnSearchTwitter.href = outreach.links?.findOnTwitter || `https://x.com/search?q=${encodeURIComponent(selectedAtsJob.company)}+%28%22engineer%22+OR+%22founder%22%29&f=user`;
  }
}

function switchOutreachTab(tab) {
  currentOutreachTab = tab;
  if (btnTabOutreachEM && btnTabOutreachFounder) {
    if (tab === 'em') {
      btnTabOutreachEM.className = 'px-2.5 py-1 bg-carbon text-paper font-bold border-r border-iron cursor-pointer';
      btnTabOutreachFounder.className = 'px-2.5 py-1 bg-void text-steel hover:text-fog cursor-pointer';
    } else {
      btnTabOutreachEM.className = 'px-2.5 py-1 bg-void text-steel hover:text-fog border-r border-iron cursor-pointer';
      btnTabOutreachFounder.className = 'px-2.5 py-1 bg-carbon text-paper font-bold cursor-pointer';
    }
  }
  renderOutreachNote();
}

async function applyToSelectedJob() {
  if (!selectedAtsJob) return;

  const credits = await fetchAndUpdateCredits();
  if (credits !== null && credits <= 0) {
    alert('⚡ Insufficient Credits\n\nYou have 0 credits remaining. Please top up your credits to apply.');
    openPricingModal();
    return;
  }

  const job = selectedAtsJob;
  if (job.status === 'applied' || job.status === 'applying') return;

  job.status = 'applying';
  selectAtsJob(job);

  if (btnInspApply && inspApplyText) {
    btnInspApply.disabled = true;
    inspApplyText.innerText = '🚀 Submitting in Chrome...';
  }

  try {
    const res = await fetch('/api/ats/apply-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.jobId })
    });
    const data = await res.json();

    if (res.status === 402 || (data.error && data.error.includes('credits'))) {
      job.status = 'failed';
      selectAtsJob(job);
      if (btnInspApply && inspApplyText) {
        btnInspApply.disabled = false;
        inspApplyText.innerText = '⚡ Apply automatically';
      }
      alert(`⚡ Insufficient Credits: ${data.error || '0 credits remaining. Please top up.'}`);
      openPricingModal();
      return;
    }

    if (data.success || data.status === 'applied') {
      job.status = 'applied';
      job.outreach = data.job?.outreach || job.outreach;
      selectAtsJob(job);
      fetchAndUpdateCredits();
      console.log('✓ Successfully applied to:', job.title);
    } else {
      job.status = data.status || 'failed';
      selectAtsJob(job);
      if (btnInspApply && inspApplyText) {
        btnInspApply.disabled = false;
        inspApplyText.innerText = '⚡ Retry Apply';
      }
      alert(`Application status: ${data.message || 'Execution completed.'}`);
    }
  } catch (err) {
    console.error('Error applying to job:', err);
    job.status = 'failed';
    selectAtsJob(job);
    if (btnInspApply && inspApplyText) {
      btnInspApply.disabled = false;
      inspApplyText.innerText = '⚡ Retry Apply';
    }
    alert(`Apply error: ${err.message}`);
  }
}

// Event Listeners setup
function initAtsJobUi() {
  if (atsSearchInput) {
    atsSearchInput.addEventListener('input', () => renderAtsJobList());
  }

  document.querySelectorAll('.ats-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ats-filter-btn').forEach(b => {
        b.classList.remove('neu-pressed', 'text-accent');
        b.classList.add('neu-raised-sm', 'text-text-secondary');
      });
      btn.classList.remove('neu-raised-sm', 'text-text-secondary');
      btn.classList.add('neu-pressed', 'text-accent');
      currentAtsFilter = btn.getAttribute('data-filter') || 'all';
      renderAtsJobList();
    });
  });

  const btnToggleAppliedView = document.getElementById('btnToggleAppliedView');
  if (btnToggleAppliedView) {
    btnToggleAppliedView.addEventListener('click', () => {
      showAppliedOnly = !showAppliedOnly;
      if (showAppliedOnly) {
        btnToggleAppliedView.classList.remove('neu-raised-sm', 'text-text-secondary');
        btnToggleAppliedView.classList.add('neu-pressed', 'text-accent');
        btnToggleAppliedView.innerText = '✓ Showing Applied';
      } else {
        btnToggleAppliedView.classList.remove('neu-pressed', 'text-accent');
        btnToggleAppliedView.classList.add('neu-raised-sm', 'text-text-secondary');
        btnToggleAppliedView.innerText = 'Show Applied';
      }
      renderAtsJobList();
    });
  }

  const btnClearAllJobs = document.getElementById('btnClearAllJobs');
  if (btnClearAllJobs) {
    btnClearAllJobs.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all saved jobs from the portal? This will reset your job feed to 0.')) {
        return;
      }
      try {
        const res = await fetch('/api/ats/clear-all-jobs', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          allAtsJobs = [];
          selectedAtsJob = null;
          if (atsEmptyInspector) atsEmptyInspector.classList.remove('hidden');
          if (atsActiveInspector) atsActiveInspector.classList.add('hidden');
          if (atsJobTotalBadge) atsJobTotalBadge.innerText = '0 ROLES';
          if (atsListCount) atsListCount.innerText = 'Showing 0 listings';
          renderAtsJobList();
          alert('✓ All saved jobs cleared! Your portal is now starting fresh at 0 jobs.');
        }
      } catch (err) {
        alert('Error clearing jobs: ' + err.message);
      }
    });
  }

  if (btnInspApply) {
    btnInspApply.addEventListener('click', applyToSelectedJob);
  }

  if (btnReanalyzeAi) {
    btnReanalyzeAi.addEventListener('click', async () => {
      if (!selectedAtsJob) return;
      if (btnReanalyzeAiText) btnReanalyzeAiText.innerText = 'Evaluating 3 AIs...';
      btnReanalyzeAi.disabled = true;
      try {
        const res = await fetch('/api/ats/evaluate-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: selectedAtsJob.jobId, forceRefresh: true })
        });
        const data = await res.json();
        if (data.evaluation) {
          selectedAtsJob.aiEvaluation = data.evaluation;
          renderAiConsensus(selectedAtsJob);
          renderBeautifiedJd(selectedAtsJob);
          renderAtsJobList();
        }
      } catch (e) {
        console.error('Re-analyze error:', e);
      } finally {
        if (btnReanalyzeAiText) btnReanalyzeAiText.innerText = '↻ Re-Analyze (3 AIs)';
        btnReanalyzeAi.disabled = false;
      }
    });
  }

  if (btnToggleFullJd && inspJobDesc) {
    let expanded = false;
    btnToggleFullJd.addEventListener('click', () => {
      expanded = !expanded;
      if (expanded) {
        inspJobDesc.classList.remove('max-h-[140px]');
        inspJobDesc.classList.add('max-h-[500px]');
        btnToggleFullJd.innerText = 'Collapse Text ↑';
      } else {
        inspJobDesc.classList.add('max-h-[140px]');
        inspJobDesc.classList.remove('max-h-[500px]');
        btnToggleFullJd.innerText = 'Expand Full Text ↓';
      }
    });
  }

  if (btnCopyOutreachNote && outreachNoteText) {
    btnCopyOutreachNote.addEventListener('click', () => {
      const textToCopy = outreachNoteText.innerText.replace(/^"|"$/g, '');
      navigator.clipboard.writeText(textToCopy).then(() => {
        if (copyNoteBtnText) {
          const orig = copyNoteBtnText.innerText;
          copyNoteBtnText.innerText = '✓ Copied to Clipboard!';
          setTimeout(() => { copyNoteBtnText.innerText = orig; }, 2000);
        }
      });
    });
  }

  if (btnTabOutreachEM) {
    btnTabOutreachEM.addEventListener('click', () => switchOutreachTab('em'));
  }
  if (btnTabOutreachFounder) {
    btnTabOutreachFounder.addEventListener('click', () => switchOutreachTab('founder'));
  }

  if (btnRefreshAtsJobs) {
    btnRefreshAtsJobs.addEventListener('click', async () => {
      if (btnRefreshAtsJobsText) btnRefreshAtsJobsText.innerText = 'Scanning Starter Startups...';
      btnRefreshAtsJobs.disabled = true;
      try {
        const res = await fetch('/api/ats/refresh', { method: 'POST' });
        const data = await res.json();
        console.log('Refreshed ATS jobs:', data);
        await loadDirectAtsJobs();
      } catch (err) {
        console.error('Refresh error:', err);
      } finally {
        if (btnRefreshAtsJobsText) btnRefreshAtsJobsText.innerText = 'Scan Starter Startups';
        btnRefreshAtsJobs.disabled = false;
      }
    });
  }

  loadDirectAtsJobs();
}

document.addEventListener('DOMContentLoaded', () => {
  initAtsJobUi();
});


// Client notification modal for AI agent problem cancellations
function showClientNotificationModal(message, job) {
  let toastContainer = document.getElementById('clientToastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'clientToastContainer';
    toastContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-md w-full pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const card = document.createElement('div');
  card.className = 'pointer-events-auto bg-stone-900 border-2 border-amber-500/80 rounded-xl p-4 shadow-2xl backdrop-blur-md transition-all duration-300 text-white flex flex-col gap-2';
  card.innerHTML = `
    <div class="flex items-center justify-between border-b border-amber-500/30 pb-2">
      <div class="flex items-center gap-2">
        <span class="text-xl">🤖</span>
        <span class="font-bold text-amber-400 text-xs tracking-wide uppercase">AI Agent Notification</span>
      </div>
      <button class="text-stone-400 hover:text-white text-base font-bold px-2 py-0.5 rounded cursor-pointer" onclick="this.closest('div.bg-stone-900').remove()">&times;</button>
    </div>
    <div class="text-sm font-medium text-stone-200 leading-relaxed">
      ${escapeHtml(message)}
    </div>
    ${job ? `<div class="text-xs text-stone-400 bg-stone-950/60 p-2 rounded border border-stone-800">Job: <span class="text-amber-200 font-semibold">${escapeHtml(job.title || '')}</span> at ${escapeHtml(job.company || '')}</div>` : ''}
  `;

  toastContainer.appendChild(card);
  setTimeout(() => {
    if (card && card.parentNode) {
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 400);
    }
  }, 14000);
}
