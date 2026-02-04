// Device discovery module
import { showToast } from './utils.js';
import { loadDevices } from './devices.js';

let adoptingDeviceId = null;

export async function loadDiscoveredDevices() {
  const list = document.getElementById('discovered-list');
  list.innerHTML = '<div class="empty-state">Scanning...</div>';

  try {
    const response = await fetch('/api/discovery/devices');
    const discovered = await response.json();

    if (discovered.length === 0) {
      list.innerHTML = '<div class="empty-state">No new displays found.<br>Make sure your ESP32 displays are powered on and connected to WiFi.</div>';
      return;
    }

    list.innerHTML = discovered.filter(d => !d.adopted).map(d => `
      <div class="discover-item">
        <div class="discover-info">
          <div class="name">${d.name}</div>
          <div class="details">IP: ${d.ip} | MAC: ${d.mac}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showAdoptModal('${d.id}', '${d.name}')">Adopt</button>
      </div>
    `).join('');

    if (list.innerHTML === '') {
      list.innerHTML = '<div class="empty-state">All discovered displays have been adopted.</div>';
    }
  } catch (error) {
    console.error('Failed to load discovered devices:', error);
    list.innerHTML = '<div class="empty-state">Failed to scan for displays</div>';
  }
}

export async function scanDevices() {
  showToast('Scanning network...', 'info');
  await fetch('/api/discovery/scan');
  setTimeout(loadDiscoveredDevices, 2000);
}

export function showAdoptModal(id, name) {
  adoptingDeviceId = id;
  document.getElementById('adopt-name').value = name;
  document.getElementById('adopt-location').value = '';
  document.getElementById('adopt-modal').classList.remove('hidden');
}

export function closeAdoptModal() {
  document.getElementById('adopt-modal').classList.add('hidden');
  adoptingDeviceId = null;
}

export async function confirmAdopt() {
  if (!adoptingDeviceId) return;

  const name = document.getElementById('adopt-name').value;
  const location = document.getElementById('adopt-location').value;

  if (!name) {
    showToast('Please enter a device name', 'error');
    return;
  }

  try {
    await fetch(`/api/discovery/adopt/${adoptingDeviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location })
    });

    closeAdoptModal();
    showToast('Display adopted successfully!', 'success');
    loadDiscoveredDevices();
    loadDevices();
    document.querySelector('.tab[data-tab="devices"]').click();
  } catch (error) {
    showToast('Failed to adopt display', 'error');
    console.error(error);
  }
}

// Make functions available globally for inline handlers
window.scanDevices = scanDevices;
window.showAdoptModal = showAdoptModal;
window.closeAdoptModal = closeAdoptModal;
window.confirmAdopt = confirmAdopt;
