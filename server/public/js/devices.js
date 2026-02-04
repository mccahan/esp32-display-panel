// Device management module
import { showToast, getActivePeriodIndex, expandCollapsible, collapseCollapsible } from './utils.js';
import { navigateTo } from './router.js';
import { globalScenes, loadGlobalScenes } from './scenes.js';
import { globalSettings } from './settings.js';

export let devices = [];
export let selectedDevice = null;

// Button drag state
let draggedButtonIndex = null;

// Import devices state
let importableDevices = [];
let creatingButtonDevice = null;
let importingButtonId = null;
let importDevices = [];

export async function loadDevices() {
  try {
    const response = await fetch('/api/devices');
    devices = await response.json();
    renderDevices();
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

export function renderDevices() {
  const list = document.getElementById('device-list');

  if (devices.length === 0) {
    list.innerHTML = '<div class="empty-state">No displays yet.<br>Go to Discover tab to add displays.</div>';
    return;
  }

  list.innerHTML = devices.map(d => `
    <div class="device-card ${selectedDevice?.id === d.id ? 'selected' : ''}" onclick="selectDevice('${d.id}')">
      <div class="device-header">
        <span class="device-name">${d.name}</span>
        <span class="device-status ${d.online ? 'online' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span>
      </div>
      <div class="device-info">
        <span>${d.location || 'No location'}</span>
        <span>${d.theme}</span>
      </div>
    </div>
  `).join('');
}

export async function selectDevice(id, updateUrl = true) {
  try {
    const response = await fetch(`/api/devices/${id}`);
    selectedDevice = await response.json();

    if (updateUrl) {
      navigateTo(`/display/${encodeURIComponent(id)}`, true);
    }

    document.getElementById('device-detail').classList.remove('hidden');
    document.getElementById('no-device-selected').classList.add('hidden');

    document.getElementById('device-name').value = selectedDevice.name;
    document.getElementById('device-theme').value = selectedDevice.config.display.theme;
    document.getElementById('device-brightness').value = selectedDevice.config.display.brightness;
    document.getElementById('brightness-value').textContent = selectedDevice.config.display.brightness + '%';

    loadScheduleConfig();
    loadDeviceThemeConfig();

    document.getElementById('device-info').innerHTML = `
      <div class="info-item"><label>IP Address</label><span>${selectedDevice.ip}</span></div>
      <div class="info-item"><label>Buttons</label><span>${selectedDevice.config.buttons.length}</span></div>
      <div class="info-item"><label>Scenes</label><span>${selectedDevice.config.scenes?.length || 0}</span></div>
      <div class="info-item"><label>Theme</label><span>${selectedDevice.config.display.theme}</span></div>
    `;

    renderButtonList();
    await loadGlobalScenes();
    renderDeviceSceneList();
    renderDevices();
    refreshScreenshot();
  } catch (error) {
    console.error('Failed to load device:', error);
    showToast('Failed to load display', 'error');
  }
}

export async function waitForDevicesAndSelect(deviceId) {
  if (devices.length > 0) {
    const device = devices.find(d => d.id === deviceId);
    if (device) {
      selectDevice(deviceId, false);
    }
    return;
  }

  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (devices.length > 0 || attempts > 20) {
      clearInterval(interval);
      const device = devices.find(d => d.id === deviceId);
      if (device) {
        selectDevice(deviceId, false);
      }
    }
  }, 100);
}

// Button management
function updateButtonName(index, name) {
  if (selectedDevice) {
    selectedDevice.config.buttons[index].name = name;
  }
}

function updateButtonType(index, type) {
  if (selectedDevice) {
    selectedDevice.config.buttons[index].type = type;
  }
}

function updateButtonIcon(index, icon) {
  if (selectedDevice) {
    selectedDevice.config.buttons[index].icon = icon;
  }
}

function updateFanSpeedSteps(index, steps) {
  if (selectedDevice && selectedDevice.config.buttons[index]) {
    selectedDevice.config.buttons[index].speedSteps = steps;
    selectedDevice.config.buttons[index].speedLevel = 0;
  }
}

function updateButtonSceneId(index, sceneId) {
  if (selectedDevice && selectedDevice.config.buttons[index]) {
    if (sceneId) {
      selectedDevice.config.buttons[index].sceneId = sceneId;
      if (sceneId === '__builtin_all_off__') {
        selectedDevice.config.buttons[index].name = 'All Off';
        selectedDevice.config.buttons[index].icon = 'power';
      } else if (sceneId === '__builtin_all_on__') {
        selectedDevice.config.buttons[index].name = 'All On';
        selectedDevice.config.buttons[index].icon = 'charge';
      } else {
        const globalScene = globalScenes.find(s => s.id === sceneId);
        if (globalScene) {
          selectedDevice.config.buttons[index].name = globalScene.name;
          selectedDevice.config.buttons[index].icon = globalScene.icon;
        }
      }
      renderButtonList();
    } else {
      delete selectedDevice.config.buttons[index].sceneId;
    }
  }
}

export function addButton() {
  if (!selectedDevice) return;
  if (selectedDevice.config.buttons.length >= 9) {
    showToast('Maximum 9 buttons allowed', 'error');
    return;
  }

  const newId = selectedDevice.config.buttons.length + 1;
  selectedDevice.config.buttons.push({
    id: newId,
    type: 'light',
    name: `Button ${newId}`,
    icon: 'charge',
    state: false,
    speedSteps: 0,
    speedLevel: 0
  });
  renderButtonList();
}

function removeButton(index) {
  if (!selectedDevice) return;
  if (selectedDevice.config.buttons.length <= 2) {
    showToast('Minimum 2 buttons required', 'error');
    return;
  }

  selectedDevice.config.buttons.splice(index, 1);
  selectedDevice.config.buttons.forEach((btn, i) => btn.id = i + 1);
  renderButtonList();
}

function getStatusText(btn) {
  if (btn.type === 'fan' && btn.speedSteps > 0 && btn.state) {
    const level = btn.speedLevel || 0;
    if (btn.speedSteps === 3) {
      return ['Off', 'Lo', 'Med', 'Hi'][level] || 'On';
    }
    return level > 0 ? `S${level}` : 'Off';
  }
  return btn.state ? 'On' : 'Off';
}

function getStatusClass(btn) {
  if (btn.type === 'scene') return 'scene';
  if (!btn.state) return 'off';
  if (btn.type === 'fan') return 'fan-on';
  return 'on';
}

async function toggleButtonState(index) {
  if (!selectedDevice) return;
  const btn = selectedDevice.config.buttons[index];
  const newState = !btn.state;
  const actionType = btn.type === 'fan' ? 'fan' : (btn.type === 'switch' ? 'switch' : 'light');

  try {
    const body = {
      deviceId: selectedDevice.id,
      state: newState,
      timestamp: Date.now()
    };

    if (btn.type === 'fan') {
      body.speedLevel = newState ? (btn.speedSteps > 0 ? 1 : 0) : 0;
    }

    const response = await fetch(`/api/action/${actionType}/${btn.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      btn.state = newState;
      if (!newState && btn.type === 'fan') {
        btn.speedLevel = 0;
      } else if (newState && btn.type === 'fan' && btn.speedSteps > 0) {
        btn.speedLevel = 1;
      }
      renderButtonList();
      showToast(`${btn.name} turned ${newState ? 'on' : 'off'}`, 'success');
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to toggle device', 'error');
    }
  } catch (error) {
    console.error('Failed to toggle device:', error);
    showToast('Failed to toggle device', 'error');
  }
}

function getBindingLabel(binding) {
  if (!binding) return 'No binding';
  return `${binding.pluginId}: ${binding.externalDeviceId.substring(0, 12)}...`;
}

export function renderButtonList() {
  if (!selectedDevice) return;
  const buttonList = document.getElementById('button-list');
  buttonList.innerHTML = selectedDevice.config.buttons.map((btn, i) => `
    <div class="button-item" draggable="true" data-index="${i}"
         ondragstart="handleButtonDragStart(event, ${i})"
         ondragover="handleButtonDragOver(event)"
         ondragenter="handleButtonDragEnter(event)"
         ondragleave="handleButtonDragLeave(event)"
         ondrop="handleButtonDrop(event, ${i})"
         ondragend="handleButtonDragEnd(event)"
         style="grid-template-columns: 24px 50px 1fr 80px ${btn.type === 'scene' ? '150px' : '80px'} ${btn.type === 'fan' ? '70px' : ''} ${btn.type !== 'scene' ? 'auto' : ''} 36px;">
      <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
      <div class="button-status ${getStatusClass(btn)}" onclick="${btn.type === 'scene' ? '' : `toggleButtonState(${i})`}" title="${btn.type === 'scene' ? 'Scene button' : 'Click to toggle'}">
        ${btn.type === 'scene' ? '▶' : getStatusText(btn)}
      </div>
      <input type="text" value="${btn.name}" onchange="updateButtonName(${i}, this.value)" placeholder="Button name">
      <select onchange="updateButtonType(${i}, this.value); renderButtonList();">
        <option value="light" ${btn.type === 'light' ? 'selected' : ''}>Light</option>
        <option value="switch" ${btn.type === 'switch' ? 'selected' : ''}>Switch</option>
        <option value="fan" ${btn.type === 'fan' ? 'selected' : ''}>Fan</option>
        <option value="scene" ${btn.type === 'scene' ? 'selected' : ''}>Scene</option>
      </select>
      ${btn.type === 'scene' ? `
      <select onchange="updateButtonSceneId(${i}, this.value)">
        <option value="">-- Select Scene --</option>
        <optgroup label="Built-in">
          <option value="__builtin_all_off__" ${btn.sceneId === '__builtin_all_off__' ? 'selected' : ''}>All Off (this display)</option>
          <option value="__builtin_all_on__" ${btn.sceneId === '__builtin_all_on__' ? 'selected' : ''}>All On (this display)</option>
        </optgroup>
        <optgroup label="Global Scenes">
          ${globalScenes.map(gs => `<option value="${gs.id}" ${btn.sceneId === gs.id ? 'selected' : ''}>${gs.name}</option>`).join('')}
        </optgroup>
      </select>
      ` : `
      <select onchange="updateButtonIcon(${i}, this.value)">
        <option value="bolt" ${btn.icon === 'bolt' || btn.icon === 'charge' ? 'selected' : ''}>Bolt</option>
        <option value="bulb" ${btn.icon === 'bulb' ? 'selected' : ''}>Bulb</option>
        <option value="ceiling_light" ${btn.icon === 'ceiling_light' || btn.icon === 'ceiling-light' ? 'selected' : ''}>Ceiling Light</option>
        <option value="door" ${btn.icon === 'door' ? 'selected' : ''}>Door</option>
        <option value="fan" ${btn.icon === 'fan' ? 'selected' : ''}>Fan</option>
        <option value="garage" ${btn.icon === 'garage' ? 'selected' : ''}>Garage</option>
        <option value="settings" ${btn.icon === 'settings' ? 'selected' : ''}>Gear</option>
        <option value="home" ${btn.icon === 'home' ? 'selected' : ''}>Home</option>
        <option value="moon" ${btn.icon === 'moon' ? 'selected' : ''}>Moon</option>
        <option value="power" ${btn.icon === 'power' ? 'selected' : ''}>Power</option>
        <option value="sleep" ${btn.icon === 'sleep' ? 'selected' : ''}>Sleep</option>
        <option value="sun" ${btn.icon === 'sun' ? 'selected' : ''}>Sun</option>
      </select>
      `}
      ${btn.type === 'fan' ? `
      <select onchange="updateFanSpeedSteps(${i}, parseInt(this.value))" title="Speed Steps">
        <option value="0" ${(btn.speedSteps || 0) === 0 ? 'selected' : ''}>On/Off</option>
        <option value="3" ${(btn.speedSteps || 0) === 3 ? 'selected' : ''}>3 Speed</option>
        <option value="4" ${(btn.speedSteps || 0) === 4 ? 'selected' : ''}>4 Speed</option>
        <option value="5" ${(btn.speedSteps || 0) === 5 ? 'selected' : ''}>5 Speed</option>
      </select>
      ` : ''}
      ${btn.type !== 'scene' ? `
      <div class="binding-indicator ${btn.binding ? '' : 'unbound'}" onclick="openImportModal(${btn.id})" title="${btn.binding ? 'Click to change binding' : 'Click to bind external device'}">
        ${btn.binding ? '🔗 Bound' : '+ Bind'}
      </div>
      ` : ''}
      <button class="btn btn-sm btn-danger" onclick="removeButton(${i})" ${selectedDevice.config.buttons.length <= 2 ? 'disabled' : ''}>×</button>
    </div>
  `).join('');
}

// Drag and drop handlers
function handleButtonDragStart(event, index) {
  draggedButtonIndex = index;
  event.target.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', index);
}

function handleButtonDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleButtonDragEnter(event) {
  event.preventDefault();
  const item = event.target.closest('.button-item');
  if (item && !item.classList.contains('dragging')) {
    item.classList.add('drag-over');
  }
}

function handleButtonDragLeave(event) {
  const item = event.target.closest('.button-item');
  if (item) {
    item.classList.remove('drag-over');
  }
}

function handleButtonDrop(event, targetIndex) {
  event.preventDefault();
  const item = event.target.closest('.button-item');
  if (item) {
    item.classList.remove('drag-over');
  }

  if (draggedButtonIndex === null || draggedButtonIndex === targetIndex) return;
  if (!selectedDevice) return;

  const buttons = selectedDevice.config.buttons;
  const [draggedButton] = buttons.splice(draggedButtonIndex, 1);
  buttons.splice(targetIndex, 0, draggedButton);
  buttons.forEach((btn, i) => btn.id = i + 1);

  renderButtonList();
  showToast('Buttons reordered', 'info');
}

function handleButtonDragEnd(event) {
  event.target.classList.remove('dragging');
  draggedButtonIndex = null;
  document.querySelectorAll('.button-item.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
}

// Scene buttons
function toggleScenes(enabled) {
  if (!selectedDevice) return;
  if (enabled) {
    if (!selectedDevice.config.scenes || selectedDevice.config.scenes.length === 0) {
      selectedDevice.config.scenes = [
        { id: 1, name: 'All Off', icon: 'power' },
        { id: 2, name: 'All On', icon: 'charge' }
      ];
    }
  } else {
    selectedDevice.config.scenes = [];
  }
  renderDeviceSceneList();
}

function renderDeviceSceneList() {
  if (!selectedDevice) return;
  const sceneList = document.getElementById('device-scene-list');
  const scenesEnabled = document.getElementById('scenes-enabled');

  const hasScenes = selectedDevice.config.scenes && selectedDevice.config.scenes.length > 0;
  scenesEnabled.checked = hasScenes;

  if (!hasScenes) {
    sceneList.innerHTML = '<div class="empty-state" style="padding: 15px; color: #666;">Toggle switch to enable scene buttons</div>';
    return;
  }

  sceneList.innerHTML = selectedDevice.config.scenes.map((scene, i) => `
    <div class="button-item" style="grid-template-columns: 1fr 150px 100px;">
      <input type="text" value="${scene.name}" onchange="updateDeviceSceneName(${i}, this.value)" placeholder="Scene name">
      <select onchange="updateDeviceSceneGlobal(${i}, this.value)">
        <option value="">-- Custom --</option>
        <optgroup label="Built-in">
          <option value="__builtin_all_off__" ${scene.globalSceneId === '__builtin_all_off__' ? 'selected' : ''}>All Off (this display)</option>
          <option value="__builtin_all_on__" ${scene.globalSceneId === '__builtin_all_on__' ? 'selected' : ''}>All On (this display)</option>
        </optgroup>
        <optgroup label="Global Scenes">
          ${globalScenes.map(gs => `<option value="${gs.id}" ${scene.globalSceneId === gs.id ? 'selected' : ''}>${gs.name}</option>`).join('')}
        </optgroup>
      </select>
      <select onchange="updateDeviceSceneIcon(${i}, this.value)">
        <option value="bolt" ${scene.icon === 'bolt' || scene.icon === 'charge' ? 'selected' : ''}>Bolt</option>
        <option value="bulb" ${scene.icon === 'bulb' ? 'selected' : ''}>Bulb</option>
        <option value="ceiling_light" ${scene.icon === 'ceiling_light' || scene.icon === 'ceiling-light' ? 'selected' : ''}>Ceiling Light</option>
        <option value="ok" ${scene.icon === 'ok' ? 'selected' : ''}>Check</option>
        <option value="door" ${scene.icon === 'door' ? 'selected' : ''}>Door</option>
        <option value="garage" ${scene.icon === 'garage' ? 'selected' : ''}>Garage</option>
        <option value="home" ${scene.icon === 'home' ? 'selected' : ''}>Home</option>
        <option value="moon" ${scene.icon === 'moon' ? 'selected' : ''}>Moon</option>
        <option value="power" ${scene.icon === 'power' ? 'selected' : ''}>Power</option>
        <option value="sleep" ${scene.icon === 'sleep' ? 'selected' : ''}>Sleep</option>
        <option value="sun" ${scene.icon === 'sun' ? 'selected' : ''}>Sun</option>
      </select>
    </div>
  `).join('');
}

function updateDeviceSceneName(index, name) {
  if (selectedDevice && selectedDevice.config.scenes) {
    selectedDevice.config.scenes[index].name = name;
  }
}

function updateDeviceSceneIcon(index, icon) {
  if (selectedDevice && selectedDevice.config.scenes) {
    selectedDevice.config.scenes[index].icon = icon;
  }
}

function updateDeviceSceneGlobal(index, globalSceneId) {
  if (selectedDevice && selectedDevice.config.scenes) {
    if (globalSceneId) {
      selectedDevice.config.scenes[index].globalSceneId = globalSceneId;
      const globalScene = globalScenes.find(s => s.id === globalSceneId);
      if (globalScene) {
        selectedDevice.config.scenes[index].name = globalScene.name;
        selectedDevice.config.scenes[index].icon = globalScene.icon;
        renderDeviceSceneList();
      }
    } else {
      delete selectedDevice.config.scenes[index].globalSceneId;
    }
  }
}

// Schedule config
function loadScheduleConfig() {
  if (!selectedDevice) return;

  const useGlobal = selectedDevice.config.display.useGlobalSchedule || false;
  const schedule = selectedDevice.config.display.brightnessSchedule || {
    enabled: false,
    timezone: 'America/Denver',
    periods: [
      { name: 'Day', startTime: '07:00', brightness: 80 },
      { name: 'Night', startTime: '20:00', brightness: 40 },
      { name: 'Late Night', startTime: '23:00', brightness: 0 }
    ],
    touchBrightness: 30,
    displayTimeout: 30
  };

  document.getElementById('use-global-schedule').checked = useGlobal;
  document.getElementById('schedule-enabled').checked = schedule.enabled;
  document.getElementById('schedule-timezone').value = schedule.timezone;
  document.getElementById('schedule-touch-brightness').value = schedule.touchBrightness;
  document.getElementById('schedule-touch-brightness-value').textContent = schedule.touchBrightness + '%';
  document.getElementById('schedule-display-timeout').value = schedule.displayTimeout;

  const deviceSettings = document.getElementById('device-schedule-settings');
  if (deviceSettings) {
    deviceSettings.style.display = useGlobal ? 'none' : 'block';
  }

  const effectiveEnabled = useGlobal
    ? (globalSettings?.brightnessSchedule?.enabled || false)
    : schedule.enabled;

  updateBrightnessSliderState(effectiveEnabled);
  renderSchedulePeriods(schedule.periods || [], schedule.timezone, schedule.enabled);
}

function toggleUseGlobalSchedule(useGlobal) {
  const deviceSettings = document.getElementById('device-schedule-settings');
  if (deviceSettings) {
    deviceSettings.style.display = useGlobal ? 'none' : 'block';
  }

  const effectiveEnabled = useGlobal
    ? (globalSettings?.brightnessSchedule?.enabled || false)
    : document.getElementById('schedule-enabled').checked;

  updateBrightnessSliderState(effectiveEnabled);
}

function updateBrightnessSliderState(scheduleEnabled) {
  const slider = document.getElementById('device-brightness');
  const container = slider.closest('.form-group');

  if (scheduleEnabled) {
    slider.disabled = true;
    slider.style.opacity = '0.5';
    slider.style.cursor = 'not-allowed';
    if (!container.querySelector('.schedule-notice')) {
      const notice = document.createElement('small');
      notice.className = 'schedule-notice';
      notice.style.cssText = 'color: #f0ad4e; display: block; margin-top: 4px;';
      notice.textContent = 'Controlled by brightness schedule';
      container.appendChild(notice);
    }
  } else {
    slider.disabled = false;
    slider.style.opacity = '1';
    slider.style.cursor = 'pointer';
    const notice = container.querySelector('.schedule-notice');
    if (notice) notice.remove();
  }
}

function renderSchedulePeriods(periods, timezone = 'America/Denver', scheduleEnabled = false) {
  const container = document.getElementById('schedule-periods-list');
  container.innerHTML = '';

  const activeIndex = scheduleEnabled ? getActivePeriodIndex(periods, timezone) : -1;

  periods.forEach((period, index) => {
    const isActive = index === activeIndex;
    const periodEl = document.createElement('div');
    periodEl.className = 'schedule-period';
    periodEl.style.cssText = `display: flex; gap: 10px; align-items: center; margin-bottom: 8px; padding: 8px; background: ${isActive ? '#2a4a2a' : '#333'}; border-radius: 4px; ${isActive ? 'border: 1px solid #4a4; box-shadow: 0 0 8px rgba(74, 170, 74, 0.3);' : 'border: 1px solid transparent;'}`;
    periodEl.innerHTML = `
      ${isActive ? '<span style="color: #4a4; font-size: 12px; margin-right: 4px;" title="Currently active">●</span>' : '<span style="width: 16px;"></span>'}
      <input type="text" class="period-name" value="${period.name}" placeholder="Name" style="width: 100px;">
      <input type="time" class="period-time" value="${period.startTime}" style="width: 110px;">
      <div class="slider-container" style="flex: 1; display: flex; align-items: center; gap: 8px;">
        <input type="range" class="period-brightness" min="0" max="100" value="${period.brightness}" style="flex: 1;" oninput="this.nextElementSibling.textContent = this.value + '%'">
        <span style="min-width: 40px; text-align: right;">${period.brightness}%</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeSchedulePeriod(${index})" style="padding: 4px 8px;">×</button>
    `;
    container.appendChild(periodEl);
  });
}

function addSchedulePeriod() {
  if (!selectedDevice) return;

  const schedule = selectedDevice.config.display.brightnessSchedule || { periods: [] };
  const periods = schedule.periods || [];

  if (periods.length >= 6) {
    showToast('Maximum 6 periods allowed', 'error');
    return;
  }

  periods.push({
    name: 'New Period',
    startTime: '12:00',
    brightness: 50
  });

  selectedDevice.config.display.brightnessSchedule = {
    ...schedule,
    periods: periods
  };

  const updatedSchedule = selectedDevice.config.display.brightnessSchedule;
  renderSchedulePeriods(periods, updatedSchedule.timezone, updatedSchedule.enabled);
}

function removeSchedulePeriod(index) {
  if (!selectedDevice) return;

  const schedule = selectedDevice.config.display.brightnessSchedule;
  if (!schedule || !schedule.periods) return;

  if (schedule.periods.length <= 1) {
    showToast('Must have at least one period', 'error');
    return;
  }

  schedule.periods.splice(index, 1);
  renderSchedulePeriods(schedule.periods, schedule.timezone, schedule.enabled);
}

function toggleScheduleEnabled(enabled) {
  if (!selectedDevice) return;

  if (!selectedDevice.config.display.brightnessSchedule) {
    selectedDevice.config.display.brightnessSchedule = {
      enabled: enabled,
      timezone: 'America/Denver',
      periods: [
        { name: 'Day', startTime: '07:00', brightness: 80 },
        { name: 'Night', startTime: '20:00', brightness: 40 },
        { name: 'Late Night', startTime: '23:00', brightness: 0 }
      ],
      touchBrightness: 30,
      displayTimeout: 30
    };
  } else {
    selectedDevice.config.display.brightnessSchedule.enabled = enabled;
  }

  updateBrightnessSliderState(enabled);

  const schedule = selectedDevice.config.display.brightnessSchedule;
  renderSchedulePeriods(schedule.periods, schedule.timezone, enabled);

  const scheduleHeader = document.querySelector('#schedule-content').previousElementSibling;
  if (scheduleHeader) {
    if (enabled) {
      expandCollapsible(scheduleHeader);
    } else {
      collapseCollapsible(scheduleHeader);
    }
  }
}

function getScheduleConfig() {
  const periods = [];
  const periodElements = document.querySelectorAll('#schedule-periods-list .schedule-period');

  periodElements.forEach(el => {
    periods.push({
      name: el.querySelector('.period-name').value,
      startTime: el.querySelector('.period-time').value,
      brightness: parseInt(el.querySelector('.period-brightness').value)
    });
  });

  periods.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    enabled: document.getElementById('schedule-enabled').checked,
    timezone: document.getElementById('schedule-timezone').value,
    periods: periods,
    touchBrightness: parseInt(document.getElementById('schedule-touch-brightness').value),
    displayTimeout: parseInt(document.getElementById('schedule-display-timeout').value)
  };
}

// Theme config
function onDeviceThemeChange(theme) {
  const hint = document.getElementById('auto-theme-hint');
  if (theme === 'auto') {
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}

function loadDeviceThemeConfig() {
  if (!selectedDevice) return;

  const dayNightMode = selectedDevice.config.display.dayNightMode || {};
  const useAuto = dayNightMode.enabled && selectedDevice.config.display.useGlobalThemeSchedule;

  const themeSelect = document.getElementById('device-theme');
  const hint = document.getElementById('auto-theme-hint');

  if (useAuto) {
    themeSelect.value = 'auto';
    hint.classList.remove('hidden');
  } else {
    themeSelect.value = selectedDevice.config.display.theme;
    hint.classList.add('hidden');
  }
}

// Save and sync
export async function saveDeviceConfig() {
  if (!selectedDevice) return;

  const name = document.getElementById('device-name').value;
  const theme = document.getElementById('device-theme').value;
  const brightness = parseInt(document.getElementById('device-brightness').value);

  selectedDevice.name = name;
  selectedDevice.config.display.brightness = brightness;

  if (theme === 'auto') {
    selectedDevice.config.display.useGlobalThemeSchedule = true;
    selectedDevice.config.display.dayNightMode = {
      ...selectedDevice.config.display.dayNightMode,
      enabled: true
    };
  } else {
    selectedDevice.config.display.theme = theme;
    selectedDevice.config.display.useGlobalThemeSchedule = false;
    selectedDevice.config.display.dayNightMode = {
      ...selectedDevice.config.display.dayNightMode,
      enabled: false
    };
  }

  selectedDevice.config.display.useGlobalSchedule = document.getElementById('use-global-schedule').checked;
  selectedDevice.config.display.brightnessSchedule = getScheduleConfig();

  showToast('Saving configuration...', 'info');

  try {
    await fetch(`/api/devices/${selectedDevice.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedDevice.config)
    });

    await fetch(`/api/devices/${selectedDevice.id}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    showToast('Configuration saved!', 'success');

    setTimeout(async () => {
      try {
        await fetch(`/api/devices/${selectedDevice.id}/screenshot/capture`, { method: 'POST' });
        setTimeout(() => {
          refreshScreenshot();
          loadDevices();
        }, 1500);
      } catch (e) {
        console.error('Failed to capture screenshot:', e);
      }
    }, 2500);

  } catch (error) {
    showToast('Failed to save configuration', 'error');
    console.error(error);
  }
}

export async function syncDeviceStates() {
  if (!selectedDevice) return;

  showToast('Syncing states from plugins...', 'info');

  try {
    const response = await fetch(`/api/devices/${selectedDevice.id}/sync`, { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      showToast(result.message || 'States synced!', 'success');
      await selectDevice(selectedDevice.id, false);

      setTimeout(async () => {
        try {
          await fetch(`/api/devices/${selectedDevice.id}/screenshot/capture`, { method: 'POST' });
          setTimeout(refreshScreenshot, 1000);
        } catch (e) {
          console.error('Failed to capture screenshot:', e);
        }
      }, 500);
    } else {
      showToast(result.error || 'Failed to sync states', 'error');
    }
  } catch (error) {
    console.error('Failed to sync device states:', error);
    showToast('Failed to sync states', 'error');
  }
}

// Screenshot
export async function captureScreenshot() {
  if (!selectedDevice) return;
  showToast('Capturing screenshot...', 'info');

  try {
    await fetch(`/api/devices/${selectedDevice.id}/screenshot/capture`, { method: 'POST' });
    setTimeout(refreshScreenshot, 1000);
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    showToast('Failed to capture screenshot', 'error');
  }
}

export function refreshScreenshot() {
  if (!selectedDevice) return;

  const img = document.getElementById('device-screenshot');
  const noScreenshot = document.getElementById('no-screenshot');
  const spinner = document.getElementById('screenshot-spinner');
  const container = document.querySelector('.screenshot-container');

  // Preserve container size to prevent layout shift
  const hadImage = img.style.display !== 'none' && img.naturalHeight > 0;
  if (hadImage) {
    container.style.minHeight = `${img.offsetHeight + 30}px`; // +30 for padding
  }

  // Show spinner, hide others
  spinner.style.display = 'block';
  img.style.display = 'none';
  noScreenshot.style.display = 'none';

  img.src = `/api/devices/${selectedDevice.id}/screenshot?t=${Date.now()}`;
  img.onload = () => {
    spinner.style.display = 'none';
    img.style.display = 'block';
    noScreenshot.style.display = 'none';
    container.style.minHeight = ''; // Reset after load
  };
  img.onerror = () => {
    spinner.style.display = 'none';
    img.style.display = 'none';
    noScreenshot.style.display = 'block';
    noScreenshot.textContent = 'No screenshot available';
    container.style.minHeight = ''; // Reset on error
  };
}

// Delete device
export async function deleteDevice() {
  if (!selectedDevice) return;
  if (!confirm(`Remove display "${selectedDevice.name}" from the system?`)) return;

  try {
    await fetch(`/api/devices/${selectedDevice.id}`, { method: 'DELETE' });
    selectedDevice = null;
    document.getElementById('device-detail').classList.add('hidden');
    document.getElementById('no-device-selected').classList.remove('hidden');
    navigateTo('/', true);
    loadDevices();
    showToast('Display removed', 'success');
  } catch (error) {
    console.error('Failed to delete device:', error);
    showToast('Failed to remove display', 'error');
  }
}

// Import binding functions
export async function openImportModal(buttonId) {
  importingButtonId = buttonId;

  try {
    const response = await fetch('/api/plugins');
    const allPlugins = await response.json();
    const providers = allPlugins.filter(p => p.hasDeviceDiscovery && p.enabled);

    const select = document.getElementById('import-plugin');
    select.innerHTML = '<option value="">Select a plugin...</option>' +
      providers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    document.getElementById('import-devices-list').innerHTML =
      '<div class="empty-state">Select a plugin to see available devices</div>';

    document.getElementById('import-modal').classList.remove('hidden');
  } catch (error) {
    showToast('Failed to load plugins', 'error');
    console.error(error);
  }
}

export function closeImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  importingButtonId = null;
  importDevices = [];
}

export async function loadImportDevices() {
  const pluginId = document.getElementById('import-plugin').value;
  const list = document.getElementById('import-devices-list');

  if (!pluginId) {
    list.innerHTML = '<div class="empty-state">Select a plugin to see available devices</div>';
    return;
  }

  list.innerHTML = '<div class="empty-state">Discovering devices...</div>';

  try {
    const response = await fetch(`/api/plugins/${pluginId}/devices`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to discover devices');
    }

    importDevices = await response.json();

    if (importDevices.length === 0) {
      list.innerHTML = '<div class="empty-state">No devices found</div>';
      return;
    }

    importDevices.sort((a, b) => a.name.localeCompare(b.name));

    list.innerHTML = importDevices.map((d, i) => `
      <div class="external-device-item" style="cursor: pointer;" onclick="bindDevice(${i})">
        <div class="external-device-info">
          <div class="name">${d.name}</div>
          <div class="details">${d.room || 'No room'}</div>
        </div>
        <span class="external-device-type">${d.type}</span>
        <button class="btn btn-sm btn-primary">Import</button>
      </div>
    `).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty-state" style="color: #ea868f;">${error.message}</div>`;
    console.error(error);
  }
}

export async function bindDevice(deviceIndex) {
  if (!selectedDevice || importingButtonId === null) return;

  const pluginId = document.getElementById('import-plugin').value;
  const externalDevice = importDevices[deviceIndex];

  try {
    const response = await fetch(`/api/devices/${selectedDevice.id}/buttons/${importingButtonId}/binding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pluginId,
        externalDeviceId: externalDevice.id,
        deviceType: externalDevice.type,
        metadata: externalDevice.metadata || {}
      })
    });

    if (response.ok) {
      showToast(`Bound to ${externalDevice.name}`, 'success');
      closeImportModal();

      const button = selectedDevice.config.buttons.find(b => b.id === importingButtonId);
      if (button) {
        button.binding = {
          pluginId,
          externalDeviceId: externalDevice.id,
          deviceType: externalDevice.type,
          metadata: externalDevice.metadata || {}
        };
        button.name = externalDevice.name;
        if (['light', 'switch', 'fan', 'outlet'].includes(externalDevice.type)) {
          button.type = externalDevice.type === 'outlet' ? 'switch' : externalDevice.type;
        }
      }
      renderButtonList();
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to create binding', 'error');
    }
  } catch (error) {
    showToast('Failed to create binding', 'error');
    console.error(error);
  }
}

// Import external devices feature
export async function discoverImportableDevices() {
  if (!selectedDevice) return;

  const list = document.getElementById('importable-devices-list');
  list.innerHTML = '<div class="empty-state" style="padding: 15px;">Discovering devices from plugins...</div>';

  try {
    const pluginsResponse = await fetch('/api/plugins');
    const allPlugins = await pluginsResponse.json();
    const enabledProviders = allPlugins.filter(p => p.hasDeviceDiscovery && p.enabled);

    if (enabledProviders.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding: 15px; color: #888;">No plugins enabled. Go to the Plugins tab to configure integrations.</div>';
      return;
    }

    importableDevices = [];

    for (const plugin of enabledProviders) {
      try {
        const response = await fetch(`/api/plugins/${plugin.id}/devices`);
        if (response.ok) {
          const devices = await response.json();
          for (const device of devices) {
            importableDevices.push({
              device,
              pluginId: plugin.id,
              pluginName: plugin.name
            });
          }
        }
      } catch (e) {
        console.error(`Failed to discover from ${plugin.name}:`, e);
      }
    }

    if (importableDevices.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding: 15px; color: #888;">No devices found from enabled plugins.</div>';
      return;
    }

    importableDevices.sort((a, b) => a.device.name.localeCompare(b.device.name));

    list.innerHTML = importableDevices.map((item, i) => `
      <div class="external-device-item">
        <div class="external-device-info">
          <div class="name">${item.device.name}</div>
          <div class="details">${item.pluginName} | ${item.device.room || 'No room'}</div>
        </div>
        <span class="external-device-type">${item.device.type}</span>
        <button class="btn btn-sm btn-primary" onclick="showCreateButtonModal(${i})">Import</button>
      </div>
    `).join('');
  } catch (error) {
    list.innerHTML = '<div class="empty-state" style="padding: 15px; color: #ea868f;">Failed to discover devices</div>';
    console.error(error);
  }
}

export function showCreateButtonModal(deviceIndex) {
  const item = importableDevices[deviceIndex];
  if (!item) return;

  creatingButtonDevice = item;

  document.getElementById('create-button-name').value = item.device.name;

  const typeMap = { light: 'light', switch: 'switch', fan: 'fan', outlet: 'switch' };
  document.getElementById('create-button-type').value = typeMap[item.device.type] || 'light';

  const iconMap = { light: 'charge', switch: 'power', fan: 'fan', outlet: 'power' };
  document.getElementById('create-button-icon').value = iconMap[item.device.type] || 'charge';

  document.getElementById('create-button-binding-info').innerHTML = `
    <strong>${item.pluginName}</strong><br>
    ${item.device.name}<br>
    <span style="color: #888; font-size: 0.85em;">ID: ${item.device.id.substring(0, 30)}${item.device.id.length > 30 ? '...' : ''}</span>
  `;

  document.getElementById('create-button-modal').classList.remove('hidden');
}

export function closeCreateButtonModal() {
  document.getElementById('create-button-modal').classList.add('hidden');
  creatingButtonDevice = null;
}

export async function confirmCreateButton() {
  if (!selectedDevice || !creatingButtonDevice) return;

  const name = document.getElementById('create-button-name').value;
  const type = document.getElementById('create-button-type').value;
  const icon = document.getElementById('create-button-icon').value;

  if (!name) {
    showToast('Please enter a button name', 'error');
    return;
  }

  if (selectedDevice.config.buttons.length >= 9) {
    showToast('Maximum 9 buttons allowed', 'error');
    return;
  }

  const newId = Math.max(...selectedDevice.config.buttons.map(b => b.id), 0) + 1;
  const newButton = {
    id: newId,
    type,
    name,
    icon,
    state: false,
    speedSteps: type === 'fan' ? 3 : 0,
    speedLevel: 0,
    binding: {
      pluginId: creatingButtonDevice.pluginId,
      externalDeviceId: creatingButtonDevice.device.id,
      deviceType: creatingButtonDevice.device.type,
      metadata: creatingButtonDevice.device.metadata || {}
    }
  };

  selectedDevice.config.buttons.push(newButton);
  renderButtonList();
  closeCreateButtonModal();
  showToast(`Created button "${name}" with ${creatingButtonDevice.pluginName} binding`, 'success');
}

// Brightness slider debounce
let brightnessDebounceTimer = null;

export function initBrightnessSlider() {
  document.getElementById('device-brightness').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('brightness-value').textContent = value + '%';

    if (brightnessDebounceTimer) {
      clearTimeout(brightnessDebounceTimer);
    }
    brightnessDebounceTimer = setTimeout(async () => {
      if (!selectedDevice) return;
      try {
        await fetch(`/api/devices/${selectedDevice.id}/brightness`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brightness: value })
        });
        selectedDevice.config.display.brightness = value;
      } catch (error) {
        console.error('Failed to set brightness:', error);
      }
    }, 150);
  });

  document.getElementById('schedule-touch-brightness').addEventListener('input', (e) => {
    document.getElementById('schedule-touch-brightness-value').textContent = e.target.value + '%';
  });
}

// Make functions available globally for inline handlers
window.selectDevice = selectDevice;
window.addButton = addButton;
window.removeButton = removeButton;
window.updateButtonName = updateButtonName;
window.updateButtonType = updateButtonType;
window.updateButtonIcon = updateButtonIcon;
window.updateFanSpeedSteps = updateFanSpeedSteps;
window.updateButtonSceneId = updateButtonSceneId;
window.toggleButtonState = toggleButtonState;
window.handleButtonDragStart = handleButtonDragStart;
window.handleButtonDragOver = handleButtonDragOver;
window.handleButtonDragEnter = handleButtonDragEnter;
window.handleButtonDragLeave = handleButtonDragLeave;
window.handleButtonDrop = handleButtonDrop;
window.handleButtonDragEnd = handleButtonDragEnd;
window.toggleScenes = toggleScenes;
window.updateDeviceSceneName = updateDeviceSceneName;
window.updateDeviceSceneIcon = updateDeviceSceneIcon;
window.updateDeviceSceneGlobal = updateDeviceSceneGlobal;
window.toggleScheduleEnabled = toggleScheduleEnabled;
window.toggleUseGlobalSchedule = toggleUseGlobalSchedule;
window.addSchedulePeriod = addSchedulePeriod;
window.removeSchedulePeriod = removeSchedulePeriod;
window.onDeviceThemeChange = onDeviceThemeChange;
window.saveDeviceConfig = saveDeviceConfig;
window.syncDeviceStates = syncDeviceStates;
window.captureScreenshot = captureScreenshot;
window.refreshScreenshot = refreshScreenshot;
window.deleteDevice = deleteDevice;
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.loadImportDevices = loadImportDevices;
window.bindDevice = bindDevice;
window.discoverImportableDevices = discoverImportableDevices;
window.showCreateButtonModal = showCreateButtonModal;
window.closeCreateButtonModal = closeCreateButtonModal;
window.confirmCreateButton = confirmCreateButton;
window.renderButtonList = renderButtonList;
