// Using bun's built-in fetch
import {
  Device,
  DeviceConfig,
  BrightnessScheduleConfig,
  getDevice,
  upsertDevice,
  deleteDevice,
  getAllDevices,
  createDefaultConfig,
  getDiscoveredDevices,
  DiscoveredDevice,
  getGlobalSettings
} from '../db';
import { ianaToPosix, parseTimeString } from '../utils/timezone';

// Convert brightness schedule for ESP32 format
// - Convert IANA timezone to POSIX
// - Convert "HH:MM" startTime strings to startHour/startMinute
function convertScheduleForDevice(schedule: BrightnessScheduleConfig | undefined): any {
  if (!schedule) return undefined;

  return {
    enabled: schedule.enabled,
    timezone: ianaToPosix(schedule.timezone),
    periods: schedule.periods.map(period => {
      const { hour, minute } = parseTimeString(period.startTime);
      return {
        name: period.name,
        startHour: hour,
        startMinute: minute,
        brightness: period.brightness
      };
    }),
    touchBrightness: schedule.touchBrightness,
    displayTimeout: schedule.displayTimeout
  };
}

// Prepare device config for ESP32 consumption
// - Applies global schedule if useGlobalSchedule is true
// - Converts schedule format (IANA→POSIX timezone, startTime→startHour/startMinute)
export function prepareConfigForDevice(device: Device): any {
  // Determine which brightness schedule to use (global or device-specific)
  let effectiveSchedule = device.config.display.brightnessSchedule;
  if (device.config.display.useGlobalSchedule) {
    const globalSettings = getGlobalSettings();
    effectiveSchedule = globalSettings.brightnessSchedule;
  }

  // Prepare config for device, converting brightness schedule format
  return {
    ...device.config,
    display: {
      ...device.config.display,
      brightnessSchedule: convertScheduleForDevice(effectiveSchedule)
    }
  };
}

// Push configuration to a device
export async function pushConfigToDevice(device: Device): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/config`;
    console.log(`Pushing config to ${device.name} at ${url}`);

    const configForDevice = prepareConfigForDevice(device);
    if (device.config.display.useGlobalSchedule) {
      console.log(`[DeviceService] Using global brightness schedule for ${device.name}`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configForDevice)
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
  const wasOffline = !device.online;

  try {
    const url = `http://${device.ip}/api/ping`;
    const response = await fetch(url);

    const online = response.ok;
    device.online = online;
    if (online) device.lastSeen = Date.now();
    upsertDevice(device);

    // If device just came online, sync reporting URL
    if (online && wasOffline) {
      const reportingUrl = process.env.REPORTING_URL;
      if (reportingUrl) {
        console.log(`[DeviceService] Device ${device.name} came online, syncing reporting URL`);
        await pushReportingUrlToDevice(device, reportingUrl);
      }
    }

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

// Push reporting URL to a device (triggers confirmation dialog on device)
export async function pushReportingUrlToDevice(
  device: Device,
  reportingUrl: string
): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/server`;
    console.log(`[DeviceService] Pushing reporting URL to ${device.name}: ${reportingUrl}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportingUrl })
    });

    if (response.ok) {
      console.log(`[DeviceService] Reporting URL push sent to ${device.name} (awaiting user confirmation)`);
      return true;
    }
    console.error(`[DeviceService] Failed to push reporting URL to ${device.name}: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`[DeviceService] Error pushing reporting URL to ${device.name}:`, error);
    return false;
  }
}

// Fetch device's actual reporting URL from the device itself
async function fetchDeviceReportingUrl(device: Device): Promise<string | null> {
  try {
    const url = `http://${device.ip}/api/device/info`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const info = await response.json() as { reportingUrl?: string };
      return info.reportingUrl || null;
    }
    return null;
  } catch {
    return null;
  }
}

// Sync reporting URL to all online devices if REPORTING_URL env var is set
export async function syncReportingUrls(): Promise<void> {
  const reportingUrl = process.env.REPORTING_URL;
  if (!reportingUrl) {
    console.log('[DeviceService] No REPORTING_URL env var set, skipping URL sync');
    return;
  }

  console.log(`[DeviceService] Syncing reporting URL to devices: ${reportingUrl}`);
  const devices = getAllDevices();

  for (const device of devices) {
    // Fetch the device's actual reporting URL (not the server's cached version)
    const deviceUrl = await fetchDeviceReportingUrl(device);

    if (deviceUrl === null) {
      console.log(`[DeviceService] Device ${device.name} is offline or unreachable, skipping URL sync`);
      device.online = false;
      upsertDevice(device);
      continue;
    }

    // Device is online
    device.online = true;
    device.lastSeen = Date.now();
    upsertDevice(device);

    if (deviceUrl !== reportingUrl) {
      console.log(`[DeviceService] Device ${device.name} has different URL (${deviceUrl}), pushing update`);
      await pushReportingUrlToDevice(device, reportingUrl);
    } else {
      console.log(`[DeviceService] Device ${device.name} already has correct reporting URL`);
    }
  }
}

// Push button state updates to a device
export async function pushButtonStatesToDevice(
  device: Device,
  buttonUpdates: Array<{ id: number; state: boolean; speedLevel?: number }>
): Promise<boolean> {
  try {
    const url = `http://${device.ip}/api/state/buttons`;
    const body = JSON.stringify({ buttons: buttonUpdates });
    console.log(`[DeviceService] Pushing states to ${device.name} (${device.ip}): ${body}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (response.ok) {
      device.lastSeen = Date.now();
      device.online = true;
      console.log(`[DeviceService] Successfully pushed states to ${device.name}`);
      return true;
    }
    console.error(`[DeviceService] Failed to push button states to ${device.name}: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`[DeviceService] Error pushing button states to ${device.name}:`, error);
    device.online = false;
    return false;
  }
}
