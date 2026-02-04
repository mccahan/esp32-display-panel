// Scene management module
import { showToast } from './utils.js';
import { navigateTo } from './router.js';

export let globalScenes = [];
export let selectedScene = null;
let availableSceneDevices = [];

export async function loadGlobalScenes() {
  try {
    const response = await fetch('/api/scenes');
    globalScenes = await response.json();
    renderSceneList();
  } catch (error) {
    console.error('Failed to load scenes:', error);
  }
}

export function renderSceneList() {
  const list = document.getElementById('scene-list');
  if (globalScenes.length === 0) {
    list.innerHTML = '<div class="empty-state">No scenes yet. Click "+ New Scene" to create one.</div>';
    return;
  }

  list.innerHTML = globalScenes.map(s => `
    <div class="scene-item ${selectedScene?.id === s.id ? 'selected' : ''}" onclick="selectScene('${s.id}')">
      <div>
        <div class="name">${s.name}</div>
        <div class="details">${s.actions.length} device${s.actions.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('');
}

export async function selectScene(id, updateUrl = true) {
  try {
    const response = await fetch(`/api/scenes/${id}`);
    selectedScene = await response.json();

    if (updateUrl) {
      navigateTo(`/scenes/${encodeURIComponent(id)}`, true);
    }

    document.getElementById('scene-editor').classList.remove('hidden');
    document.getElementById('no-scene-selected').classList.add('hidden');

    document.getElementById('scene-name').value = selectedScene.name;
    document.getElementById('scene-icon').value = selectedScene.icon;

    renderSceneActions();
    renderSceneList();
  } catch (error) {
    console.error('Failed to load scene:', error);
    showToast('Failed to load scene', 'error');
  }
}

export async function waitForScenesAndSelect(sceneId) {
  await loadGlobalScenes();
  const scene = globalScenes.find(s => s.id === sceneId);
  if (scene) {
    selectScene(sceneId, false);
  }
}

export function createNewScene() {
  selectedScene = {
    id: null,
    name: '',
    icon: 'power',
    actions: []
  };

  document.getElementById('scene-editor').classList.remove('hidden');
  document.getElementById('no-scene-selected').classList.add('hidden');

  document.getElementById('scene-name').value = '';
  document.getElementById('scene-icon').value = 'power';

  renderSceneActions();
  renderSceneList();
}

function renderSceneActions() {
  const list = document.getElementById('scene-actions-list');
  if (!selectedScene || selectedScene.actions.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding: 15px; color: #666;">Add devices to control when this scene is activated</div>';
    return;
  }

  list.innerHTML = selectedScene.actions.map((action, i) => `
    <div class="scene-action-item">
      <div class="device-info">
        <span class="device-name">${action.deviceName}</span>
        <span class="device-plugin">${action.pluginId} • ${action.deviceType}</span>
      </div>
      <div class="scene-state-toggle" onclick="toggleSceneActionState(${i})" title="Click to toggle">
        <span class="state-label ${action.targetState ? 'on' : 'off'}">${action.targetState ? 'ON' : 'OFF'}</span>
      </div>
      ${action.deviceType === 'fan' ? `
      <select onchange="updateSceneActionSpeed(${i}, this.value)">
        <option value="0" ${action.targetSpeedLevel === 0 ? 'selected' : ''}>Off</option>
        <option value="1" ${action.targetSpeedLevel === 1 ? 'selected' : ''}>Low</option>
        <option value="2" ${action.targetSpeedLevel === 2 ? 'selected' : ''}>Med</option>
        <option value="3" ${action.targetSpeedLevel === 3 ? 'selected' : ''}>High</option>
      </select>
      ` : '<div></div>'}
      <button class="btn btn-sm btn-danger" onclick="removeSceneAction(${i})">×</button>
    </div>
  `).join('');
}

function toggleSceneActionState(index) {
  if (selectedScene && selectedScene.actions[index]) {
    selectedScene.actions[index].targetState = !selectedScene.actions[index].targetState;
    renderSceneActions();
  }
}

function updateSceneActionState(index, value) {
  if (selectedScene && selectedScene.actions[index]) {
    selectedScene.actions[index].targetState = value === 'on';
  }
}

function updateSceneActionSpeed(index, value) {
  if (selectedScene && selectedScene.actions[index]) {
    selectedScene.actions[index].targetSpeedLevel = parseInt(value);
  }
}

function removeSceneAction(index) {
  if (selectedScene) {
    selectedScene.actions.splice(index, 1);
    renderSceneActions();
  }
}

export async function openSceneDevicePicker() {
  document.getElementById('scene-device-picker-modal').classList.remove('hidden');
  document.getElementById('scene-device-picker-list').innerHTML = '<div class="empty-state">Loading available devices...</div>';

  try {
    const response = await fetch('/api/scenes/available/devices');
    availableSceneDevices = await response.json();

    availableSceneDevices.sort((a, b) => a.device.name.localeCompare(b.device.name));

    if (availableSceneDevices.length === 0) {
      document.getElementById('scene-device-picker-list').innerHTML =
        '<div class="empty-state">No devices available. Enable a plugin and discover devices first.</div>';
      return;
    }

    renderSceneDevicePicker();
  } catch (error) {
    console.error('Failed to load available devices:', error);
    document.getElementById('scene-device-picker-list').innerHTML =
      '<div class="empty-state" style="color: #ea868f;">Failed to load devices</div>';
  }
}

function renderSceneDevicePicker() {
  if (!selectedScene || availableSceneDevices.length === 0) return;

  document.getElementById('scene-device-picker-list').innerHTML = availableSceneDevices.map((item, i) => {
    const isAdded = selectedScene.actions.some(a =>
      a.pluginId === item.pluginId && a.externalDeviceId === item.device.id
    );

    return `
      <div class="device-picker-item ${isAdded ? 'added' : ''}" onclick="toggleDeviceInScene(${i})">
        <div class="device-info">
          <div class="device-name">${item.device.name}</div>
          <div class="device-details">${item.pluginName} • ${item.device.type}${item.device.room ? ' • ' + item.device.room : ''}</div>
        </div>
        <button class="btn btn-sm ${isAdded ? 'btn-danger' : 'btn-primary'}">${isAdded ? 'Remove' : 'Add'}</button>
      </div>
    `;
  }).join('');
}

export function closeSceneDevicePicker() {
  document.getElementById('scene-device-picker-modal').classList.add('hidden');
}

function toggleDeviceInScene(deviceIndex) {
  if (!selectedScene) return;

  const item = availableSceneDevices[deviceIndex];

  const existingIndex = selectedScene.actions.findIndex(a =>
    a.pluginId === item.pluginId && a.externalDeviceId === item.device.id
  );

  if (existingIndex >= 0) {
    selectedScene.actions.splice(existingIndex, 1);
    showToast(`Removed ${item.device.name}`, 'info');
  } else {
    selectedScene.actions.push({
      pluginId: item.pluginId,
      externalDeviceId: item.device.id,
      deviceName: item.device.name,
      deviceType: item.device.type,
      targetState: true,
      targetSpeedLevel: item.device.type === 'fan' ? 1 : undefined
    });
    showToast(`Added ${item.device.name}`, 'success');
  }

  renderSceneActions();
  renderSceneDevicePicker();
}

export async function saveScene() {
  if (!selectedScene) return;

  const name = document.getElementById('scene-name').value;
  const icon = document.getElementById('scene-icon').value;

  if (!name) {
    showToast('Please enter a scene name', 'error');
    return;
  }

  selectedScene.name = name;
  selectedScene.icon = icon;

  try {
    let response;
    if (selectedScene.id) {
      response = await fetch(`/api/scenes/${selectedScene.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedScene)
      });
    } else {
      response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedScene)
      });
    }

    if (response.ok) {
      const saved = await response.json();
      selectedScene = saved;
      showToast('Scene saved!', 'success');
      await loadGlobalScenes();
      navigateTo(`/scenes/${encodeURIComponent(saved.id)}`, true);
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to save scene', 'error');
    }
  } catch (error) {
    console.error('Failed to save scene:', error);
    showToast('Failed to save scene', 'error');
  }
}

export async function testScene() {
  if (!selectedScene || !selectedScene.id) {
    showToast('Save the scene first before testing', 'error');
    return;
  }

  showToast('Executing scene...', 'info');

  try {
    const response = await fetch(`/api/scenes/${selectedScene.id}/execute`, {
      method: 'POST'
    });

    const result = await response.json();
    if (result.success) {
      showToast(`Scene "${result.scene}" executed successfully!`, 'success');
    } else {
      const failed = result.results.filter(r => !r.success);
      showToast(`Scene executed with ${failed.length} error(s)`, 'error');
    }
  } catch (error) {
    console.error('Failed to execute scene:', error);
    showToast('Failed to execute scene', 'error');
  }
}

export async function deleteScene() {
  if (!selectedScene || !selectedScene.id) return;
  if (!confirm(`Delete scene "${selectedScene.name}"?`)) return;

  try {
    await fetch(`/api/scenes/${selectedScene.id}`, { method: 'DELETE' });
    selectedScene = null;
    document.getElementById('scene-editor').classList.add('hidden');
    document.getElementById('no-scene-selected').classList.remove('hidden');
    navigateTo('/scenes', true);
    await loadGlobalScenes();
    showToast('Scene deleted', 'success');
  } catch (error) {
    console.error('Failed to delete scene:', error);
    showToast('Failed to delete scene', 'error');
  }
}

// Make functions available globally for inline handlers
window.selectScene = selectScene;
window.createNewScene = createNewScene;
window.toggleSceneActionState = toggleSceneActionState;
window.updateSceneActionState = updateSceneActionState;
window.updateSceneActionSpeed = updateSceneActionSpeed;
window.removeSceneAction = removeSceneAction;
window.openSceneDevicePicker = openSceneDevicePicker;
window.closeSceneDevicePicker = closeSceneDevicePicker;
window.toggleDeviceInScene = toggleDeviceInScene;
window.saveScene = saveScene;
window.testScene = testScene;
window.deleteScene = deleteScene;
