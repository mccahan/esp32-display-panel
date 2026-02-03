"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushConfigToDevice = pushConfigToDevice;
exports.fetchDeviceState = fetchDeviceState;
exports.pingDevice = pingDevice;
exports.captureDeviceScreenshot = captureDeviceScreenshot;
exports.getDeviceScreenshot = getDeviceScreenshot;
exports.adoptDevice = adoptDevice;
exports.updateDeviceConfig = updateDeviceConfig;
exports.checkAllDevicesHealth = checkAllDevicesHealth;
exports.startHealthChecks = startHealthChecks;
exports.stopHealthChecks = stopHealthChecks;
exports.pushButtonStatesToDevice = pushButtonStatesToDevice;
const node_fetch_1 = __importDefault(require("node-fetch"));
const db_1 = require("../db");
// Push configuration to a device
async function pushConfigToDevice(device) {
    try {
        const url = `http://${device.ip}/api/config`;
        console.log(`Pushing config to ${device.name} at ${url}`);
        const response = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(device.config)
        });
        if (response.ok) {
            console.log(`Config pushed successfully to ${device.name}`);
            device.lastSeen = Date.now();
            device.online = true;
            (0, db_1.upsertDevice)(device);
            return true;
        }
        else {
            console.error(`Failed to push config to ${device.name}: ${response.status}`);
            return false;
        }
    }
    catch (error) {
        console.error(`Error pushing config to ${device.name}:`, error);
        device.online = false;
        (0, db_1.upsertDevice)(device);
        return false;
    }
}
// Get device state from device
async function fetchDeviceState(device) {
    try {
        const url = `http://${device.ip}/api/state`;
        const response = await (0, node_fetch_1.default)(url);
        if (response.ok) {
            device.lastSeen = Date.now();
            device.online = true;
            (0, db_1.upsertDevice)(device);
            return await response.json();
        }
        return null;
    }
    catch (error) {
        device.online = false;
        (0, db_1.upsertDevice)(device);
        return null;
    }
}
// Check if device is online (ping)
async function pingDevice(device) {
    try {
        const url = `http://${device.ip}/api/ping`;
        const response = await (0, node_fetch_1.default)(url);
        const online = response.ok;
        device.online = online;
        if (online)
            device.lastSeen = Date.now();
        (0, db_1.upsertDevice)(device);
        return online;
    }
    catch (error) {
        device.online = false;
        (0, db_1.upsertDevice)(device);
        return false;
    }
}
// Capture screenshot from device
async function captureDeviceScreenshot(device) {
    try {
        const url = `http://${device.ip}/api/screenshot/capture`;
        const response = await (0, node_fetch_1.default)(url, { method: 'POST' });
        return response.ok;
    }
    catch (error) {
        console.error(`Failed to capture screenshot from ${device.name}:`, error);
        return false;
    }
}
// Get screenshot from device (returns Buffer)
async function getDeviceScreenshot(device) {
    try {
        const url = `http://${device.ip}/api/screenshot/view`;
        const response = await (0, node_fetch_1.default)(url);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
        return null;
    }
    catch (error) {
        console.error(`Failed to get screenshot from ${device.name}:`, error);
        return null;
    }
}
// Adopt a discovered device
function adoptDevice(discovered, name, location, serverIp) {
    const config = (0, db_1.createDefaultConfig)(discovered.id, name, serverIp);
    config.device.name = name;
    config.device.location = location;
    const device = {
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
    (0, db_1.upsertDevice)(device);
    console.log(`Adopted device: ${name} (${discovered.id})`);
    return device;
}
// Update device configuration
function updateDeviceConfig(deviceId, updates) {
    const device = (0, db_1.getDevice)(deviceId);
    if (!device)
        return null;
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
    if (updates.device?.name)
        device.name = updates.device.name;
    if (updates.device?.location)
        device.location = updates.device.location;
    (0, db_1.upsertDevice)(device);
    return device;
}
// Periodic health check for all devices
async function checkAllDevicesHealth() {
    const devices = (0, db_1.getAllDevices)();
    console.log(`Checking health of ${devices.length} devices...`);
    for (const device of devices) {
        await pingDevice(device);
    }
}
// Start periodic health checks
let healthCheckInterval = null;
function startHealthChecks(intervalMs = 60000) {
    if (healthCheckInterval)
        return;
    healthCheckInterval = setInterval(checkAllDevicesHealth, intervalMs);
    console.log(`Started health checks every ${intervalMs / 1000} seconds`);
}
function stopHealthChecks() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}
// Push button state updates to a device
async function pushButtonStatesToDevice(device, buttonUpdates) {
    try {
        const url = `http://${device.ip}/api/state/buttons`;
        const response = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buttons: buttonUpdates })
        });
        if (response.ok) {
            device.lastSeen = Date.now();
            device.online = true;
            return true;
        }
        console.error(`Failed to push button states to ${device.name}: ${response.status}`);
        return false;
    }
    catch (error) {
        console.error(`Error pushing button states to ${device.name}:`, error);
        device.online = false;
        return false;
    }
}
//# sourceMappingURL=deviceService.js.map