// Main application entry point
import { registerRouteHandler, handleRoute, navigateTo, switchTab } from './router.js';
import { loadDevices, waitForDevicesAndSelect, selectDevice, selectedDevice, initBrightnessSlider } from './devices.js';
import { loadDiscoveredDevices } from './discovery.js';
import { loadPlugins, waitForPluginsAndSelect, selectedPlugin } from './plugins.js';
import { loadGlobalScenes, waitForScenesAndSelect, selectedScene } from './scenes.js';
import { loadGlobalSettings } from './settings.js';

// Register route handlers
registerRouteHandler('device', waitForDevicesAndSelect);
registerRouteHandler('scene', waitForScenesAndSelect);
registerRouteHandler('scenesTab', loadGlobalScenes);
registerRouteHandler('discover', loadDiscoveredDevices);
registerRouteHandler('plugin', waitForPluginsAndSelect);
registerRouteHandler('pluginsTab', loadPlugins);
registerRouteHandler('settings', loadGlobalSettings);

// Tab click handlers with URL updates
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    if (tabName === 'devices') {
      if (selectedDevice) {
        navigateTo(`/display/${encodeURIComponent(selectedDevice.id)}`);
      } else {
        navigateTo('/');
      }
    } else if (tabName === 'scenes') {
      if (selectedScene) {
        navigateTo(`/scenes/${encodeURIComponent(selectedScene.id)}`);
      } else {
        navigateTo('/scenes');
      }
    } else if (tabName === 'discover') {
      navigateTo('/discover');
    } else if (tabName === 'plugins') {
      if (selectedPlugin) {
        navigateTo(`/plugins/${encodeURIComponent(selectedPlugin.id)}`);
      } else {
        navigateTo('/plugins');
      }
    } else if (tabName === 'settings') {
      navigateTo('/settings');
    }
  });
});

// Initialize application
function init() {
  initBrightnessSlider();
  loadDevices();
  loadGlobalScenes();

  // Periodic device refresh
  setInterval(loadDevices, 30000);

  // Handle initial route
  handleRoute();
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
