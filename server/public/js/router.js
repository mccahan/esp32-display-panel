// Deep-link routing module

let routeHandlers = {};

export function registerRouteHandler(route, handler) {
  routeHandlers[route] = handler;
}

export function navigateTo(path, replace = false) {
  if (replace) {
    history.replaceState(null, '', '#' + path);
  } else {
    history.pushState(null, '', '#' + path);
  }
  handleRoute();
}

export function handleRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === '') {
    switchTab('devices');
    return;
  }

  const route = parts[0];

  switch (route) {
    case 'display':
    case 'device':
      switchTab('devices');
      if (parts[1] && routeHandlers.device) {
        const deviceId = decodeURIComponent(parts[1]);
        routeHandlers.device(deviceId);
        if (route === 'device') {
          navigateTo(`/display/${encodeURIComponent(deviceId)}`, true);
        }
      }
      break;

    case 'scenes':
      switchTab('scenes');
      if (parts[1] && routeHandlers.scene) {
        routeHandlers.scene(decodeURIComponent(parts[1]));
      } else if (routeHandlers.scenesTab) {
        routeHandlers.scenesTab();
      }
      break;

    case 'discover':
      switchTab('discover');
      if (routeHandlers.discover) {
        routeHandlers.discover();
      }
      break;

    case 'plugins':
      switchTab('plugins');
      if (parts[1] && routeHandlers.plugin) {
        routeHandlers.plugin(decodeURIComponent(parts[1]));
      } else if (routeHandlers.pluginsTab) {
        routeHandlers.pluginsTab();
      }
      break;

    case 'settings':
      switchTab('settings');
      if (routeHandlers.settings) {
        routeHandlers.settings();
      }
      break;

    default:
      switchTab('devices');
  }
}

export function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');

  document.getElementById('tab-devices').classList.toggle('hidden', tabName !== 'devices');
  document.getElementById('tab-scenes').classList.toggle('hidden', tabName !== 'scenes');
  document.getElementById('tab-discover').classList.toggle('hidden', tabName !== 'discover');
  document.getElementById('tab-plugins').classList.toggle('hidden', tabName !== 'plugins');
  document.getElementById('tab-settings').classList.toggle('hidden', tabName !== 'settings');
}

// Listen for browser back/forward
window.addEventListener('popstate', handleRoute);

// Make navigateTo globally available
window.navigateTo = navigateTo;
