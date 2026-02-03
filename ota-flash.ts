#!/usr/bin/env bun
/**
 * OTA Flash CLI Tool
 *
 * Discovers ESP32 display devices via mDNS and flashes firmware via OTA.
 *
 * Usage:
 *   bun ota-flash.ts [--all] [--firmware <path>]
 *
 * Options:
 *   --all         Flash all discovered devices without prompting
 *   --firmware    Path to firmware.bin (default: .pio/build/esp32s3/firmware.bin)
 *
 * Examples:
 *   bun ota-flash.ts              # Interactive device selection
 *   bun ota-flash.ts --all        # Flash all discovered devices
 *   bun ota-flash.ts -f custom.bin --all
 */

import Bonjour, { Service } from 'bonjour-service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';

interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
}

const DEFAULT_FIRMWARE_PATH = '.pio/build/esp32s3/firmware.bin';
const DISCOVERY_TIMEOUT_MS = 5000;

// Parse command line arguments
function parseArgs(): { flashAll: boolean; firmwarePath: string } {
  const args = process.argv.slice(2);
  let flashAll = false;
  let firmwarePath = DEFAULT_FIRMWARE_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all' || args[i] === '-a') {
      flashAll = true;
    } else if (args[i] === '--firmware' || args[i] === '-f') {
      firmwarePath = args[++i];
    }
  }

  return { flashAll, firmwarePath };
}

// Calculate MD5 hash of file
function calculateMD5(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
}

// Discover devices via mDNS
async function discoverDevices(): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const devices: DiscoveredDevice[] = [];
    const bonjour = new Bonjour();

    console.log('🔍 Discovering ESP32 displays via mDNS...');

    const browser = bonjour.find({ type: 'esp32display' }, (service: Service) => {
      const txt = service.txt || {};
      const id = txt.id || service.name;
      const name = txt.name || service.name;
      const ip = service.addresses?.find(addr => !addr.includes(':')) || service.host;

      // Avoid duplicates
      if (!devices.find(d => d.id === id)) {
        devices.push({
          id,
          name,
          ip,
          port: service.port
        });
        console.log(`   Found: ${name} (${ip})`);
      }
    });

    // Wait for discovery timeout then return results
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(devices);
    }, DISCOVERY_TIMEOUT_MS);
  });
}

// Prompt user to select devices
async function selectDevices(devices: DiscoveredDevice[]): Promise<DiscoveredDevice[]> {
  if (devices.length === 0) {
    return [];
  }

  console.log('\nAvailable devices:');
  devices.forEach((device, index) => {
    console.log(`  [${index + 1}] ${device.name} (${device.ip})`);
  });
  console.log(`  [a] All devices`);
  console.log(`  [q] Quit`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\nSelect device(s) to flash (e.g., 1,2 or a for all): ', (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();

      if (trimmed === 'q' || trimmed === '') {
        resolve([]);
        return;
      }

      if (trimmed === 'a' || trimmed === 'all') {
        resolve(devices);
        return;
      }

      // Parse comma-separated numbers
      const indices = trimmed.split(',')
        .map(s => parseInt(s.trim(), 10) - 1)
        .filter(i => i >= 0 && i < devices.length);

      const selected = indices.map(i => devices[i]);
      resolve(selected);
    });
  });
}

// Poll device until it reboots (uptime < threshold)
async function waitForReboot(ip: string, timeoutMs: number = 60000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 1000;
  const uptimeThreshold = 15; // Device considered rebooted if uptime < 15s

  // Wait a bit for device to go down first
  await new Promise(r => setTimeout(r, 2000));

  while (Date.now() - startTime < timeoutMs) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`http://${ip}/api/info`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.uptime_seconds < uptimeThreshold) {
          return true; // Device has rebooted
        }
      }
    } catch {
      // Device not responding yet, keep polling
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  return false; // Timeout
}

// Flash firmware to a single device
async function flashDevice(device: DiscoveredDevice, firmwarePath: string, md5Hash: string): Promise<boolean> {
  const baseUrl = `http://${device.ip}`;

  try {
    // Step 1: Start OTA update
    console.log(`   Starting OTA on ${device.name}...`);
    const startUrl = `${baseUrl}/ota/start?mode=fr&hash=${md5Hash}`;
    const startResponse = await fetch(startUrl);

    if (!startResponse.ok) {
      console.error(`   ❌ Failed to start OTA: ${startResponse.status}`);
      return false;
    }

    // Step 2: Upload firmware
    console.log(`   Uploading firmware...`);
    const firmwareBuffer = fs.readFileSync(firmwarePath);
    const formData = new FormData();
    formData.append('file', new Blob([firmwareBuffer]), 'firmware.bin');

    // Race between upload completing and detecting device reboot
    const uploadPromise = fetch(`${baseUrl}/ota/upload`, {
      method: 'POST',
      body: formData
    }).then(response => ({ type: 'upload' as const, response }));

    const rebootPromise = waitForReboot(device.ip).then(rebooted => ({
      type: 'reboot' as const,
      rebooted
    }));

    const result = await Promise.race([uploadPromise, rebootPromise]);

    if (result.type === 'upload') {
      if (!result.response.ok) {
        console.error(`   ❌ Failed to upload firmware: ${result.response.status}`);
        return false;
      }
      console.log(`   ✅ Flash successful! Device will reboot.`);
      return true;
    } else {
      // Reboot detected
      if (result.rebooted) {
        console.log(`   ✅ Flash successful! Device rebooted.`);
        return true;
      } else {
        console.error(`   ❌ Timeout waiting for device to reboot`);
        return false;
      }
    }

  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return false;
  }
}

// Main entry point
async function main(): Promise<void> {
  const { flashAll, firmwarePath } = parseArgs();

  // Check firmware exists
  const absoluteFirmwarePath = path.isAbsolute(firmwarePath)
    ? firmwarePath
    : path.join(process.cwd(), firmwarePath);

  if (!fs.existsSync(absoluteFirmwarePath)) {
    console.error(`❌ Firmware not found: ${absoluteFirmwarePath}`);
    console.error(`\nRun 'pio run' first to build the firmware.`);
    process.exit(1);
  }

  // Calculate MD5
  const md5Hash = calculateMD5(absoluteFirmwarePath);
  const fileSize = fs.statSync(absoluteFirmwarePath).size;
  console.log(`📦 Firmware: ${path.basename(absoluteFirmwarePath)}`);
  console.log(`   Size: ${(fileSize / 1024).toFixed(1)} KB`);
  console.log(`   MD5: ${md5Hash}\n`);

  // Discover devices
  const devices = await discoverDevices();

  if (devices.length === 0) {
    console.log('\n⚠️  No devices found. Make sure devices are powered on and connected to WiFi.');
    process.exit(1);
  }

  console.log(`\n✅ Found ${devices.length} device(s)\n`);

  // Select devices to flash
  let selectedDevices: DiscoveredDevice[];

  if (flashAll) {
    selectedDevices = devices;
    console.log(`Flashing all ${devices.length} device(s)...`);
  } else {
    selectedDevices = await selectDevices(devices);
  }

  if (selectedDevices.length === 0) {
    console.log('No devices selected. Exiting.');
    process.exit(0);
  }

  // Flash selected devices
  console.log(`\n🚀 Flashing ${selectedDevices.length} device(s)...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const device of selectedDevices) {
    console.log(`\n📡 ${device.name} (${device.ip})`);
    const success = await flashDevice(device, absoluteFirmwarePath, md5Hash);

    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Small delay between devices
    if (selectedDevices.indexOf(device) < selectedDevices.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(40));
  console.log(`📊 Results: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
