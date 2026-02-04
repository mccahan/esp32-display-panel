// Plugin management module
import { showToast } from './utils.js';
import { navigateTo } from './router.js';

export let plugins = [];
export let selectedPlugin = null;

export async function loadPlugins() {
  try {
    const response = await fetch('/api/plugins');
    plugins = await response.json();
    renderPluginList();
  } catch (error) {
    console.error('Failed to load plugins:', error);
  }
}

export function renderPluginList() {
  const list = document.getElementById('plugin-list');
  if (plugins.length === 0) {
    list.innerHTML = '<div class="empty-state">No plugins installed</div>';
    return;
  }

  list.innerHTML = plugins.map(p => `
    <div class="plugin-item ${selectedPlugin?.id === p.id ? 'selected' : ''}" onclick="selectPlugin('${p.id}')">
      <div class="plugin-info">
        <div class="name">${p.name}</div>
        <div class="description">${p.description || p.type}</div>
      </div>
      <span class="plugin-status ${p.enabled ? 'enabled' : 'disabled'}">${p.enabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  `).join('');
}

export async function selectPlugin(id, updateUrl = true) {
  try {
    const response = await fetch(`/api/plugins/${id}`);
    selectedPlugin = await response.json();

    if (updateUrl) {
      navigateTo(`/plugins/${encodeURIComponent(id)}`, true);
    }

    document.getElementById('plugin-config').classList.remove('hidden');
    document.getElementById('no-plugin-selected').classList.add('hidden');
    document.getElementById('plugin-config-title').textContent = `${selectedPlugin.name} Configuration`;

    renderPluginList();

    await loadPluginUI(selectedPlugin.id);
    renderPluginConfigForm();

    const devicesCard = document.getElementById('plugin-devices-card');
    if (selectedPlugin.hasDeviceDiscovery) {
      devicesCard.classList.remove('hidden');
      discoverPluginDevices();
    } else {
      devicesCard.classList.add('hidden');
    }
  } catch (error) {
    console.error('Failed to load plugin:', error);
    showToast('Failed to load plugin', 'error');
  }
}

export async function waitForPluginsAndSelect(pluginId) {
  await loadPlugins();
  const plugin = plugins.find(p => p.id === pluginId);
  if (plugin) {
    selectPlugin(pluginId, false);
  }
}

async function loadPluginUI(pluginId) {
  const container = document.getElementById('plugin-custom-ui');

  try {
    const response = await fetch(`/api/plugins/${pluginId}/ui`);
    const data = await response.json();

    if (data.hasUI && data.content) {
      container.innerHTML = data.content;
      container.classList.remove('hidden');

      const scripts = container.querySelectorAll('script');
      scripts.forEach(script => {
        const newScript = document.createElement('script');
        newScript.textContent = script.textContent;
        script.parentNode.replaceChild(newScript, script);
      });
    } else {
      container.innerHTML = '';
      container.classList.add('hidden');
    }
  } catch (error) {
    console.error('Failed to load plugin UI:', error);
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}

function renderPluginConfigForm() {
  if (!selectedPlugin) return;

  const form = document.getElementById('plugin-config-form');

  let settingsHtml = '';
  const pluginUI = window[selectedPlugin.id.replace(/-/g, '') + 'UI'] || window[selectedPlugin.id + 'UI'];
  if (pluginUI && typeof pluginUI.renderSettings === 'function') {
    settingsHtml = pluginUI.renderSettings(selectedPlugin.settings || {});
  }

  form.innerHTML = `
    <div class="form-group">
      <label>Enabled</label>
      <label class="toggle-switch">
        <input type="checkbox" id="plugin-enabled" ${selectedPlugin.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    ${settingsHtml}
  `;
}

export async function savePluginConfig() {
  if (!selectedPlugin) return;

  const enabled = document.getElementById('plugin-enabled').checked;
  let settings = null;

  const pluginUI = window[selectedPlugin.id.replace(/-/g, '') + 'UI'] || window[selectedPlugin.id + 'UI'];
  if (pluginUI && typeof pluginUI.getSettings === 'function') {
    settings = pluginUI.getSettings();
  }

  const body = { enabled };
  if (settings !== null) {
    body.settings = settings;
  }

  try {
    const response = await fetch(`/api/plugins/${selectedPlugin.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      showToast('Plugin configuration saved', 'success');
      await loadPlugins();
      await selectPlugin(selectedPlugin.id);
    } else {
      const error = await response.json();
      showToast(error.error || 'Failed to save configuration', 'error');
    }
  } catch (error) {
    showToast('Failed to save configuration', 'error');
    console.error(error);
  }
}

export async function testPluginConnection() {
  if (!selectedPlugin) return;

  let settings = {};
  const pluginUI = window[selectedPlugin.id.replace(/-/g, '') + 'UI'] || window[selectedPlugin.id + 'UI'];
  if (pluginUI && typeof pluginUI.getSettings === 'function') {
    settings = pluginUI.getSettings();
  }

  showToast('Testing connection...', 'info');

  try {
    const response = await fetch(`/api/plugins/${selectedPlugin.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });

    const result = await response.json();
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message || 'Connection failed', 'error');
    }
  } catch (error) {
    showToast('Connection test failed', 'error');
    console.error(error);
  }
}

export async function discoverPluginDevices() {
  if (!selectedPlugin) return;

  const list = document.getElementById('plugin-devices-list');
  list.innerHTML = '<div class="empty-state">Discovering devices...</div>';

  try {
    const response = await fetch(`/api/plugins/${selectedPlugin.id}/devices`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to discover devices');
    }

    const devices = await response.json();
    if (devices.length === 0) {
      list.innerHTML = '<div class="empty-state">No devices found</div>';
      return;
    }

    devices.sort((a, b) => a.name.localeCompare(b.name));

    list.innerHTML = devices.map(d => `
      <div class="external-device-item">
        <div class="external-device-info">
          <div class="name">${d.name}</div>
          <div class="details">${d.room || 'No room'} | ${d.id.substring(0, 20)}...</div>
        </div>
        <span class="external-device-type">${d.type}</span>
      </div>
    `).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty-state" style="color: #ea868f;">${error.message}</div>`;
    console.error(error);
  }
}

// Make functions available globally for inline handlers
window.selectPlugin = selectPlugin;
window.savePluginConfig = savePluginConfig;
window.testPluginConnection = testPluginConnection;
window.discoverPluginDevices = discoverPluginDevices;
