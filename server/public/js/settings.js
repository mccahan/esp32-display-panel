// Global settings module
import { showToast, getActivePeriodIndex } from './utils.js';
import { navigateTo } from './router.js';
import { devices } from './devices.js';

export let globalSettings = null;

export function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.settingsTab === tabName);
  });

  document.querySelectorAll('.settings-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `settings-panel-${tabName}`);
  });
}

export async function loadGlobalSettings() {
  try {
    const response = await fetch('/api/settings');
    globalSettings = await response.json();

    const schedule = globalSettings.brightnessSchedule;
    document.getElementById('global-schedule-enabled').checked = schedule.enabled;
    document.getElementById('global-schedule-timezone').value = schedule.timezone;
    document.getElementById('global-schedule-touch-brightness').value = schedule.touchBrightness;
    document.getElementById('global-schedule-touch-brightness-value').textContent = schedule.touchBrightness + '%';
    document.getElementById('global-schedule-display-timeout').value = schedule.displayTimeout;

    renderGlobalSchedulePeriods(schedule.periods);

    const brightnessHeader = document.querySelector('#settings-panel-brightness .collapsible-header');
    const brightnessContent = document.getElementById('global-schedule-content');
    if (schedule.enabled) {
      brightnessHeader.classList.remove('collapsed');
      brightnessContent.classList.remove('collapsed');
    } else {
      brightnessHeader.classList.add('collapsed');
      brightnessContent.classList.add('collapsed');
    }

    const themeSchedule = globalSettings.themeSchedule || {
      dayTheme: 'light_mode',
      nightTheme: 'dark_mode',
      dayStartHour: 7,
      nightStartHour: 20
    };
    document.getElementById('global-theme-day').value = themeSchedule.dayTheme;
    document.getElementById('global-theme-night').value = themeSchedule.nightTheme;
    document.getElementById('global-theme-day-start').value = themeSchedule.dayStartHour;
    document.getElementById('global-theme-night-start').value = themeSchedule.nightStartHour;

    loadDeviceScheduleStatus();
    loadDeviceThemeScheduleStatus();

  } catch (error) {
    console.error('Failed to load global settings:', error);
    showToast('Failed to load settings', 'error');
  }
}

function renderGlobalSchedulePeriods(periods) {
  const container = document.getElementById('global-schedule-periods-list');
  const timezone = document.getElementById('global-schedule-timezone').value;
  const scheduleEnabled = document.getElementById('global-schedule-enabled').checked;

  const activePeriodIndex = scheduleEnabled ? getActivePeriodIndex(periods, timezone) : -1;

  container.innerHTML = periods.map((period, index) => {
    const isActive = index === activePeriodIndex;
    return `
      <div class="schedule-period ${isActive ? 'active-period' : ''}" data-index="${index}">
        <span class="period-active-indicator" style="display: ${isActive ? 'inline-block' : 'none'}; color: #4CAF50; margin-right: 5px;">●</span>
        <input type="text" class="period-name" value="${period.name}" placeholder="Period name" style="width: 100px;">
        <input type="time" class="period-time" value="${period.startTime}">
        <input type="range" class="period-brightness" min="0" max="100" value="${period.brightness}" oninput="this.nextElementSibling.textContent = this.value + '%'">
        <span class="period-brightness-value">${period.brightness}%</span>
        <button class="btn btn-sm btn-danger" onclick="removeGlobalSchedulePeriod(${index})" ${periods.length <= 1 ? 'disabled' : ''}>×</button>
      </div>
    `;
  }).join('');
}

function getGlobalScheduleConfig() {
  const periods = [];
  document.querySelectorAll('#global-schedule-periods-list .schedule-period').forEach(el => {
    periods.push({
      name: el.querySelector('.period-name').value,
      startTime: el.querySelector('.period-time').value,
      brightness: parseInt(el.querySelector('.period-brightness').value)
    });
  });

  periods.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    enabled: document.getElementById('global-schedule-enabled').checked,
    timezone: document.getElementById('global-schedule-timezone').value,
    periods: periods,
    touchBrightness: parseInt(document.getElementById('global-schedule-touch-brightness').value),
    displayTimeout: parseInt(document.getElementById('global-schedule-display-timeout').value)
  };
}

export function addGlobalSchedulePeriod() {
  const container = document.getElementById('global-schedule-periods-list');
  const periodCount = container.querySelectorAll('.schedule-period').length;

  if (periodCount >= 6) {
    showToast('Maximum 6 periods allowed', 'error');
    return;
  }

  const index = periodCount;
  const periodHtml = `
    <div class="schedule-period" data-index="${index}">
      <span class="period-active-indicator" style="display: none; color: #4CAF50; margin-right: 5px;">●</span>
      <input type="text" class="period-name" value="New Period" placeholder="Period name" style="width: 100px;">
      <input type="time" class="period-time" value="12:00">
      <input type="range" class="period-brightness" min="0" max="100" value="50" oninput="this.nextElementSibling.textContent = this.value + '%'">
      <span class="period-brightness-value">50%</span>
      <button class="btn btn-sm btn-danger" onclick="removeGlobalSchedulePeriod(${index})">×</button>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', periodHtml);

  if (periodCount + 1 > 1) {
    container.querySelectorAll('.btn-danger').forEach(btn => btn.disabled = false);
  }
}

export function removeGlobalSchedulePeriod(index) {
  const container = document.getElementById('global-schedule-periods-list');
  const periods = container.querySelectorAll('.schedule-period');

  if (periods.length <= 1) {
    showToast('At least one period required', 'error');
    return;
  }

  periods[index].remove();

  const remaining = container.querySelectorAll('.schedule-period');
  remaining.forEach((el, i) => {
    el.dataset.index = i;
    el.querySelector('.btn-danger').setAttribute('onclick', `removeGlobalSchedulePeriod(${i})`);
    el.querySelector('.btn-danger').disabled = remaining.length <= 1;
  });
}

export function toggleGlobalScheduleEnabled(enabled) {
  const header = document.querySelector('#tab-settings .collapsible-header');
  const content = document.getElementById('global-schedule-content');

  if (enabled) {
    header.classList.remove('collapsed');
    content.classList.remove('collapsed');
  } else {
    header.classList.add('collapsed');
    content.classList.add('collapsed');
  }

  const periods = [];
  document.querySelectorAll('#global-schedule-periods-list .schedule-period').forEach(el => {
    periods.push({
      name: el.querySelector('.period-name').value,
      startTime: el.querySelector('.period-time').value,
      brightness: parseInt(el.querySelector('.period-brightness').value)
    });
  });
  renderGlobalSchedulePeriods(periods);
}

function getGlobalThemeConfig() {
  return {
    enabled: true,
    dayTheme: document.getElementById('global-theme-day').value,
    nightTheme: document.getElementById('global-theme-night').value,
    dayStartHour: parseInt(document.getElementById('global-theme-day-start').value),
    nightStartHour: parseInt(document.getElementById('global-theme-night-start').value)
  };
}

function loadDeviceThemeScheduleStatus() {
  const container = document.getElementById('device-theme-schedule-status-list');

  if (devices.length === 0) {
    container.innerHTML = '<div class="empty-state">No displays configured</div>';
    return;
  }

  container.innerHTML = devices.map(device => {
    const useAutoTheme = device.config?.display?.useGlobalThemeSchedule === true;
    const currentTheme = device.config?.display?.theme || 'dark_mode';

    const themeLabel = useAutoTheme ? 'Auto Light/Dark' : currentTheme.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    const badgeClass = useAutoTheme ? 'badge-global' : 'badge-custom';

    const pushButton = useAutoTheme
      ? `<button class="btn btn-sm btn-primary" onclick="pushThemeScheduleToDevice('${device.id}')">Push</button>`
      : '';

    return `
      <div class="device-schedule-item">
        <div class="device-schedule-info">
          <strong>${device.name || device.id}</strong>
        </div>
        <div class="device-schedule-type">
          <span class="${badgeClass}">${themeLabel}</span>
          ${pushButton}
          <button class="btn btn-sm btn-secondary" onclick="navigateTo('/device/${device.id}')">Edit</button>
        </div>
      </div>
    `;
  }).join('');
}

export async function pushThemeScheduleToDevice(deviceId) {
  try {
    showToast('Pushing theme schedule...', 'info');
    const response = await fetch(`/api/devices/${deviceId}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) throw new Error('Failed to push config');

    showToast('Theme schedule pushed successfully', 'success');
  } catch (error) {
    console.error('Failed to push theme schedule:', error);
    showToast('Failed to push theme schedule', 'error');
  }
}

export async function saveGlobalSettings() {
  try {
    const brightnessSchedule = getGlobalScheduleConfig();
    const themeSchedule = getGlobalThemeConfig();

    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightnessSchedule, themeSchedule })
    });

    if (!response.ok) throw new Error('Failed to save settings');

    globalSettings = await response.json();
    showToast('Global settings saved', 'success');

    loadDeviceScheduleStatus();
    loadDeviceThemeScheduleStatus();

  } catch (error) {
    console.error('Failed to save global settings:', error);
    showToast('Failed to save settings', 'error');
  }
}

function loadDeviceScheduleStatus() {
  const container = document.getElementById('device-schedule-status-list');

  if (devices.length === 0) {
    container.innerHTML = '<div class="empty-state">No displays configured</div>';
    return;
  }

  container.innerHTML = devices.map(device => {
    const useGlobal = device.config?.display?.useGlobalSchedule;
    const scheduleEnabled = useGlobal
      ? globalSettings?.brightnessSchedule?.enabled
      : device.config?.display?.brightnessSchedule?.enabled;

    const statusClass = useGlobal ? 'using-global' : 'using-custom';
    const statusText = useGlobal ? 'Using Global Schedule' : 'Custom Schedule';
    const scheduleStatus = scheduleEnabled ? 'Enabled' : 'Disabled';

    return `
      <div class="device-schedule-item ${statusClass}">
        <div class="device-schedule-info">
          <strong>${device.name || device.id}</strong>
          <span class="schedule-status ${scheduleEnabled ? 'enabled' : 'disabled'}">${scheduleStatus}</span>
        </div>
        <div class="device-schedule-type">
          <span class="${useGlobal ? 'badge-global' : 'badge-custom'}">${statusText}</span>
          <button class="btn btn-sm btn-secondary" onclick="navigateTo('/device/${device.id}')">Edit</button>
        </div>
      </div>
    `;
  }).join('');
}

// Make functions available globally for inline handlers
window.switchSettingsTab = switchSettingsTab;
window.addGlobalSchedulePeriod = addGlobalSchedulePeriod;
window.removeGlobalSchedulePeriod = removeGlobalSchedulePeriod;
window.toggleGlobalScheduleEnabled = toggleGlobalScheduleEnabled;
window.pushThemeScheduleToDevice = pushThemeScheduleToDevice;
window.saveGlobalSettings = saveGlobalSettings;
