import fetch from 'node-fetch';
import {
  Device,
  DeviceConfig,
  getDevice,
  upsertDevice,
  deleteDevice,
  getAllDevices,
  createDefaultConfig,
  getDiscoveredDevices,
  DiscoveredDevice
} from '../db';

// Push configuration to a device
export async function pushConfigToDevice(device: Device): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/config`;
    console.log(`Pushing config to ${device.name} at ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(device.config)
    });

    if (response.ok) {
      console.log(`Config pushed successfully to ${device.name}`);
      device.lastSeen = Date.now();
      device.online = true;
      upsertDevice(device);
      return true;
    } else {
      console.error(`Failed to push config to ${device.name}: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`Error pushing config to ${device.name}:`, error);
    device.online = false;
    upsertDevice(device);
    return false;
  }
}

// Get device state from device
export async function fetchDeviceState(device: Device): Promise<any | null> {
  try {
    const url = `http://${device.ip}/api/state`;
    const response = await fetch(url);

    if (response.ok) {
      device.lastSeen = Date.now();
      device.online = true;
      upsertDevice(device);
      return await response.json();
    }
    return null;
  } catch (error) {
    device.online = false;
    upsertDevice(device);
    return null;
  }
}

// Check if device is online (ping)
export async function pingDevice(device: Device): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/ping`;
    const response = await fetch(url);

    const online = response.ok;
    device.online = online;
    if (online) device.lastSeen = Date.now();
    upsertDevice(device);
    return online;
  } catch (error) {
    device.online = false;
    upsertDevice(device);
    return false;
  }
}

// Capture screenshot from device
export async function captureDeviceScreenshot(device: Device): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/screenshot/capture`;
    const response = await fetch(url, { method: 'POST' });
    return response.ok;
  } catch (error) {
    console.error(`Failed to capture screenshot from ${device.name}:`, error);
    return false;
  }
}

// Get screenshot from device (returns Buffer)
export async function getDeviceScreenshot(device: Device): Promise<Buffer | null> {
  try {
    const url = `http://${device.ip}/api/screenshot/view`;
    const response = await fetch(url);

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error(`Failed to get screenshot from ${device.name}:`, error);
    return null;
  }
}

// Adopt a discovered device
export function adoptDevice(
  discovered: DiscoveredDevice,
  name: string,
  location: string,
  serverIp: string
): Device {
  const config = createDefaultConfig(discovered.id, name, serverIp);
  config.device.name = name;
  config.device.location = location;

  const device: Device = {
    id: discovered.id,
    mac: discovered.mac,
    ip: discovered.ip,
    name,
    location,
    config,
    lastSeen: Date.now(),
    online: true,
    adopted: true
  };

  upsertDevice(device);
  console.log(`Adopted device: ${name} (${discovered.id})`);

  return device;
}

// Update device configuration
export function updateDeviceConfig(
  deviceId: string,
  updates: Partial<DeviceConfig>
): Device | null {
  const device = getDevice(deviceId);
  if (!device) return null;

  // Deep merge the configuration
  device.config = {
    ...device.config,
    ...updates,
    device: { ...device.config.device, ...updates.device },
    display: { ...device.config.display, ...updates.display },
    buttons: updates.buttons || device.config.buttons,
    scenes: updates.scenes || device.config.scenes,
    server: { ...device.config.server, ...updates.server }
  };

  // Update device name/location if changed
  if (updates.device?.name) device.name = updates.device.name;
  if (updates.device?.location) device.location = updates.device.location;

  upsertDevice(device);
  return device;
}

// Periodic health check for all devices
export async function checkAllDevicesHealth(): Promise<void> {
  const devices = getAllDevices();
  console.log(`Checking health of ${devices.length} devices...`);

  for (const device of devices) {
    await pingDevice(device);
  }
}

// Start periodic health checks
let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthChecks(intervalMs: number = 60000): void {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(checkAllDevicesHealth, intervalMs);
  console.log(`Started health checks every ${intervalMs / 1000} seconds`);
}

export function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}
