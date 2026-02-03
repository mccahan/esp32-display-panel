import Bonjour, { Service } from 'bonjour-service';
import { addDiscoveredDevice, DiscoveredDevice, getDevice, upsertDevice } from '../db';
import { pushReportingUrlToDevice } from './deviceService';

const bonjour = new Bonjour();
let browser: ReturnType<typeof bonjour.find> | null = null;

// Start mDNS discovery
export function startDiscovery(): void {
  if (browser) {
    console.log('Discovery already running');
    return;
  }

  console.log('Starting mDNS discovery for _esp32display._tcp...');

  browser = bonjour.find({ type: 'esp32display' }, async (service: Service) => {
    console.log('Discovered device:', service.name, service.addresses);

    // Extract device info from TXT records
    const txt = service.txt || {};
    const id = txt.id || service.name;
    const mac = txt.mac || 'unknown';
    const name = txt.name || service.name;

    // Get first IPv4 address
    const ip = service.addresses?.find(addr => !addr.includes(':')) || service.host;

    // Check if this is an already-adopted device
    const adoptedDevice = getDevice(id);
    if (adoptedDevice && adoptedDevice.adopted) {
      const ipChanged = adoptedDevice.ip !== ip;
      const wasOffline = !adoptedDevice.online;

      if (ipChanged) {
        console.log(`[Discovery] Updating adopted device ${adoptedDevice.name} IP: ${adoptedDevice.ip} -> ${ip}`);
        adoptedDevice.ip = ip;
      }

      adoptedDevice.online = true;
      adoptedDevice.lastSeen = Date.now();
      upsertDevice(adoptedDevice);

      // Sync reporting URL if env var is set and device was offline or IP changed
      const reportingUrl = process.env.REPORTING_URL;
      if (reportingUrl && (ipChanged || wasOffline)) {
        console.log(`[Discovery] Syncing reporting URL to ${adoptedDevice.name}`);
        await pushReportingUrlToDevice(adoptedDevice, reportingUrl);
      }
      return;
    }

    const device: DiscoveredDevice = {
      id,
      name,
      mac,
      ip,
      port: service.port,
      discoveredAt: Date.now()
    };

    addDiscoveredDevice(device);
    console.log(`Added discovered device: ${id} at ${ip}:${service.port}`);
  });
}

// Stop discovery
export function stopDiscovery(): void {
  if (browser) {
    browser.stop();
    browser = null;
    console.log('mDNS discovery stopped');
  }
}

// Trigger a manual scan (discovery is continuous, but this logs the current state)
export function triggerScan(): void {
  console.log('Manual scan triggered - discovery is continuous');
  // The browser is already running and will pick up new devices
}

// Cleanup on exit
process.on('beforeExit', () => {
  stopDiscovery();
  bonjour.destroy();
});
