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
      b.classList.remove('border-ember', 'text-paper', 'font-bold', 'border-blue-500', 'text-blue-400');
      b.classList.add('border-transparent', 'text-steel');
    });
    btn.classList.add('border-ember', 'text-paper', 'font-bold');
    btn.classList.remove('border-transparent', 'text-steel');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const target = document.getElementById(btn.getAttribute('data-tab'));
    if (target) target.classList.remove('hidden');

    if (btn.getAttribute('data-tab') === 'tab-history') {
      loadHistory();
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
  });

  eventSource.addEventListener('current_job', e => {
    const job = JSON.parse(e.data);
    updateCurrentJobUI(job);
  });

  eventSource.addEventListener('log', e => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
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
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-[2px] border border-pewter bg-carbon text-xs font-bold uppercase tracking-wider text-fog';
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
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-[2px] border border-iron bg-carbon text-xs font-bold uppercase tracking-wider text-steel';
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
  btnStart.disabled = true;
  btnStart.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin fill-current" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> <span>Starting...</span>`;
  try {
    await fetch('/api/start', { method: 'POST' });
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
      badge.className = 'text-[10px] px-2 py-0.5 rounded-[2px] font-bold border border-ember bg-void text-ember uppercase';
    }
    if (btn) {
      btn.innerHTML = '<span>Stop Autopilot</span> <span>×</span>';
      btn.className = 'px-4 py-2 rounded-[2px] bg-carbon hover:bg-void border border-rose-900/60 text-rose-400 text-xs font-bold uppercase tracking-wider transition flex items-center gap-1 cursor-pointer';
    }
  } else {
    if (badge) {
      badge.textContent = 'INACTIVE';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-[2px] font-bold border bg-void text-steel border-iron uppercase';
    }
    if (btn) {
      btn.innerHTML = '<span>Turn Autopilot ON</span> <span>→</span>';
      btn.className = 'px-4 py-2 rounded-[2px] bg-carbon hover:bg-void border border-slate text-paper text-xs font-bold uppercase tracking-wider transition flex items-center gap-1 cursor-pointer';
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

document.getElementById('btnToggleAutopilot').addEventListener('click', async () => {
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

    document.getElementById('profAuthorized').value = currentProfile.workAuthorization?.legallyAuthorized || 'Yes';
    document.getElementById('profSponsorship').value = currentProfile.workAuthorization?.requireSponsorship || 'No';
    document.getElementById('profSalaryNumeric').value = currentProfile.compensationAndAvailability?.desiredSalaryNumeric || 50000;
    document.getElementById('profNoticeWeeks').value = currentProfile.compensationAndAvailability?.noticePeriodWeeks || 2;
    document.getElementById('profLinkedin').value = currentProfile.personal?.links?.linkedin || '';
    document.getElementById('profGithub').value = currentProfile.personal?.links?.github || '';

    renderSkillsTable(currentProfile.workExperienceYears || {});
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

function renderSkillsTable(skills) {
  const container = document.getElementById('skillsTable');
  container.innerHTML = '';

  for (const [skill, years] of Object.entries(skills)) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-2.5 rounded-[2px] bg-void border border-iron';
    row.innerHTML = `
      <span class="text-xs font-semibold text-paper">${escapeHtml(skill)}</span>
      <div class="flex items-center gap-2">
        <input type="number" min="0" max="25" value="${years}" data-skill="${escapeHtml(skill)}" class="skill-input w-14 bg-carbon border border-iron rounded-[2px] px-2 py-1 text-xs text-paper text-right focus:outline-none focus:border-ember" />
        <span class="text-[10px] text-steel uppercase">YRS</span>
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
});
