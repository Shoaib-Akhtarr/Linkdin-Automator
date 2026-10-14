// Frontend Application Logic for LinkedIn Easy Apply Suite

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

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('border-blue-500', 'text-blue-400');
      b.classList.add('border-transparent', 'text-zinc-400');
    });
    btn.classList.add('border-blue-500', 'text-blue-400');
    btn.classList.remove('border-transparent', 'text-zinc-400');

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
    if (data.stats) updateStatsUI(data.stats);
    if (data.currentJob) updateCurrentJobUI(data.currentJob);
    if (data.autopilot) updateAutopilotUI(data.autopilot);
    if (data.logs) {
      logContainer.innerHTML = '';
      data.logs.reverse().forEach(appendLog);
    }
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

function updateStateUI(state) {
  currentState = state;
  statusText.textContent = state.toUpperCase().replace('_', ' ');

  if (state === 'running') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold uppercase tracking-wider text-emerald-400';
    btnStart.classList.add('hidden');
    btnPause.classList.remove('hidden');
    btnStop.classList.remove('hidden');
    reviewBanner.classList.add('hidden');
  } else if (state === 'paused') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs font-semibold uppercase tracking-wider text-amber-400';
    btnStart.classList.remove('hidden');
    btnStart.textContent = 'Resume';
    btnPause.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else if (state === 'awaiting_review') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 text-xs font-bold uppercase tracking-wider text-amber-300';
    reviewBanner.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnPause.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    // idle or stopped
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-semibold uppercase tracking-wider text-zinc-400';
    btnStart.classList.remove('hidden');
    btnStart.innerHTML = `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Start`;
    btnPause.classList.add('hidden');
    btnStop.classList.add('hidden');
    reviewBanner.classList.add('hidden');
  }
}

function updateStatsUI(stats) {
  metricToday.textContent = stats.todayApplied || 0;
  metricLimit.textContent = `/ ${stats.dailyLimit || 25} limit`;
  metricRemaining.textContent = stats.remainingToday || 0;
  metricTotal.textContent = stats.totalApplied || 0;
  metricSkipped.textContent = (stats.skipped || 0) + (stats.failed || 0);

  const pct = Math.min(100, Math.round(((stats.todayApplied || 0) / (stats.dailyLimit || 25)) * 100));
  metricProgressBar.style.width = `${pct}%`;
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
  line.className = 'flex items-start gap-2';

  let colorClass = 'text-zinc-400';
  if (entry.type === 'success') colorClass = 'text-emerald-400 font-semibold';
  if (entry.type === 'warn') colorClass = 'text-amber-400';
  if (entry.type === 'error') colorClass = 'text-rose-400 font-semibold';

  line.innerHTML = `
    <span class="text-zinc-600 select-none">[${entry.timestamp}]</span>
    <span class="${colorClass}">${escapeHtml(entry.message)}</span>
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
  await fetch('/api/start', { method: 'POST' });
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
      badge.textContent = 'ACTIVE (AUTOPILOT)';
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full font-bold border bg-purple-500/20 text-purple-300 border-purple-500/40 animate-pulse';
    }
    if (btn) {
      btn.innerHTML = '<span>Stop Autopilot</span>';
      btn.className = 'px-4 py-2 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-rose-900/30 cursor-pointer';
    }
  } else {
    if (badge) {
      badge.textContent = 'INACTIVE';
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full font-semibold border bg-zinc-800 text-zinc-400 border-zinc-700';
    }
    if (btn) {
      btn.innerHTML = '<span>Turn Autopilot ON</span>';
      btn.className = 'px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-purple-900/30 cursor-pointer';
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
    row.className = 'flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80';
    row.innerHTML = `
      <span class="text-xs font-semibold text-zinc-200">${escapeHtml(skill)}</span>
      <div class="flex items-center gap-2">
        <input type="number" min="0" max="25" value="${years}" data-skill="${escapeHtml(skill)}" class="skill-input w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-blue-500" />
        <span class="text-[11px] text-zinc-500">yrs</span>
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
  // Collect form
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

  // Collect skills
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

    document.getElementById('setMode').value = currentSettings.execution?.mode || 'hybrid';
    document.getElementById('setDailyLimit').value = currentSettings.execution?.dailyApplicationLimit || 25;
    document.getElementById('setDatePosted').value = currentSettings.search?.datePosted || 'pastWeek';

    document.getElementById('setKeywords').value = (currentSettings.search?.keywords || []).join(', ');
    
    // Location & Workplace
    const locVal = currentSettings.search?.location || 'Worldwide';
    document.getElementById('setLocation').value = locVal;

    const wpVal = currentSettings.search?.workplaceType || (currentSettings.search?.remoteOnly ? 'remote' : 'all');
    document.getElementById('setWorkplaceType').value = wpVal;

    const applyTypeVal = currentSettings.search?.applyType || (currentSettings.search?.easyApplyOnly === false ? 'all' : 'easy_apply');
    document.getElementById('setApplyType').value = applyTypeVal;

    document.getElementById('setBlacklist').value = (currentSettings.search?.blacklistCompanies || []).join(', ');

    // Intellisense options
    const intelli = currentSettings.intelligence || {};
    document.getElementById('setIntelliReadJD').checked = intelli.readFullDescription !== false;
    document.getElementById('setIntelliClearance').checked = intelli.filterSecurityClearance !== false;
    document.getElementById('setIntelliCitizenship').checked = intelli.filterCitizenshipRestricted !== false;
    document.getElementById('setIntelliDynamicCV').checked = intelli.dynamicCVGeneration !== false;

    // Update active bar
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

  if (barLoc) barLoc.textContent = location || 'Worldwide / Anywhere';
  if (barWp) {
    const wpLabels = { remote: 'Remote Only', hybrid: 'Hybrid', onsite: 'On-Site', all: 'All Workplaces' };
    barWp.textContent = wpLabels[workplace] || workplace;
  }
  if (barMode) barMode.textContent = mode ? mode.toUpperCase() : 'HYBRID';
  if (barApplyType) {
    barApplyType.textContent = (applyType === 'all') ? 'All Jobs (Easy Apply + External ATS)' : 'Easy Apply Only';
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
  currentSettings.execution.mode = document.getElementById('setMode').value;
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

  // Intellisense settings
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
    alert('✓ Settings, Search Location & Intellisense filters successfully saved!');
  } else {
    alert('Error saving settings.');
  }
});

// History Management
async function loadHistory() {
  try {
    const res = await fetch('/api/applications');
    const apps = await res.json();
    const tbody = document.getElementById('historyTableBody');

    if (!apps || apps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-zinc-500">No applications recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = apps.map(app => {
      const date = app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : 'N/A';
      let statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Applied</span>';
      if (app.status === 'skipped') {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 font-medium">Skipped</span>';
      } else if (app.status === 'failed') {
        statusBadge = '<span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">Failed</span>';
      }

      let cvContent = '<span class="text-zinc-500">—</span>';
      if (app.notes) {
        const cvMatch = app.notes.match(/Tailored ATS CV:\s*([^\s,]+)/i);
        if (cvMatch && cvMatch[1]) {
          const cvFile = cvMatch[1].trim();
          cvContent = `<a href="/tailored_cvs/${encodeURIComponent(cvFile)}" target="_blank" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 font-medium text-[11px] border border-purple-500/30" title="Click to view tailored vector PDF">📄 ${escapeHtml(cvFile)}</a>`;
        } else {
          cvContent = `<span class="text-zinc-400 text-[11px] truncate max-w-[220px] block" title="${escapeHtml(app.notes)}">${escapeHtml(app.notes)}</span>`;
        }
      }

      const hasNumericId = app.jobId && /^\d+$/.test(String(app.jobId).trim());
      const link = hasNumericId
        ? `<a href="https://www.linkedin.com/jobs/view/${app.jobId}/" target="_blank" class="text-blue-400 hover:underline">View</a>`
        : (app.url ? `<a href="${escapeHtml(app.url)}" target="_blank" class="text-blue-400 hover:underline">View</a>` : '<span class="text-zinc-600">—</span>');

      return `
        <tr class="hover:bg-zinc-900/50">
          <td class="py-3 px-4 text-zinc-400 whitespace-nowrap">${date}</td>
          <td class="py-3 px-4 font-semibold text-white">${escapeHtml(app.title)}</td>
          <td class="py-3 px-4 text-zinc-300">${escapeHtml(app.company)}</td>
          <td class="py-3 px-4 text-zinc-400 whitespace-nowrap">${escapeHtml(app.location)}</td>
          <td class="py-3 px-4 whitespace-nowrap">${statusBadge}</td>
          <td class="py-3 px-4">${cvContent}</td>
          <td class="py-3 px-4 whitespace-nowrap">${link}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// Export CSV
document.getElementById('btnExportCsv').addEventListener('click', async () => {
  const res = await fetch('/api/applications');
  const apps = await res.json();
  if (!apps || apps.length === 0) {
    alert('No applications to export.');
    return;
  }

  const headers = ['Date', 'Job ID', 'Title', 'Company', 'Location', 'Status', 'Notes'];
  const rows = apps.map(a => [
    `"${a.appliedAt || ''}"`,
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
  a.download = `linkedin_applications_${new Date().toISOString().split('T')[0]}.csv`;
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
