import Bonjour, { Service } from 'bonjour-service';
import { addDiscoveredDevice, DiscoveredDevice } from '../db';

const bonjour = new Bonjour();
let browser: ReturnType<typeof bonjour.find> | null = null;

// Start mDNS discovery
export function startDiscovery(): void {
  if (browser) {
    console.log('Discovery already running');
    return;
  }

  console.log('Starting mDNS discovery for _esp32display._tcp...');

  browser = bonjour.find({ type: 'esp32display' }, (service: Service) => {
    console.log('Discovered device:', service.name, service.addresses);

    // Extract device info from TXT records
    const txt = service.txt || {};
    const id = txt.id || service.name;
    const mac = txt.mac || 'unknown';
    const name = txt.name || service.name;

    // Get first IPv4 address
    const ip = service.addresses?.find(addr => !addr.includes(':')) || service.host;

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
