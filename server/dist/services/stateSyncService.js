"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStatePolling = startStatePolling;
exports.syncDevice = syncDevice;
exports.stopStatePolling = stopStatePolling;
exports.forcePluginPoll = forcePluginPoll;
exports.forceDevicePush = forceDevicePush;
const db_1 = require("../db");
const pluginManager_1 = require("../plugins/pluginManager");
const deviceService_1 = require("./deviceService");
const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds default
const TICK_INTERVAL = 5000; // Check every 5 seconds which plugins need polling
const FORCE_PUSH_INTERVAL = 60000; // Force push states every 60 seconds even if unchanged
let tickInterval = null;
const lastPollTime = new Map();
const lastPushTime = new Map(); // Track last push per device
// Get the polling interval for a plugin
function getPluginPollingInterval(pluginId) {
    const plugin = pluginManager_1.pluginManager.getPlugin(pluginId);
    return plugin?.pollingInterval || DEFAULT_POLL_INTERVAL;
}
// Check if a plugin is due for polling
function shouldPollPlugin(pluginId, now) {
    const lastPoll = lastPollTime.get(pluginId) || 0;
    const interval = getPluginPollingInterval(pluginId);
    return (now - lastPoll) >= interval;
}
// Check if a device needs a forced state push (heartbeat)
function shouldForcePush(deviceId, now) {
    const lastPush = lastPushTime.get(deviceId) || 0;
    return (now - lastPush) >= FORCE_PUSH_INTERVAL;
}
// Push all button states to a device (regardless of changes)
async function pushAllStatesToDevice(device) {
    const buttonUpdates = device.config.buttons.map(btn => {
        const update = {
            id: btn.id,
            state: btn.state
        };
        // Only include speedLevel for fan-type buttons
        if (btn.type === 'fan') {
            update.speedLevel = btn.speedLevel;
        }
        return update;
    });
    console.log(`[StateSync] Force pushing ${buttonUpdates.length} button states to ${device.name}`);
    const success = await (0, deviceService_1.pushButtonStatesToDevice)(device, buttonUpdates);
    if (success) {
        lastPushTime.set(device.id, Date.now());
    }
    return success;
}
// Poll devices bound to a specific plugin
async function pollPluginDevices(pluginId) {
    const devices = (0, db_1.getAllDevices)();
    const now = Date.now();
    for (const device of devices) {
        if (!device.online) {
            continue;
        }
        const buttonUpdates = [];
        let hasChanges = false;
        let hasBoundButtons = false;
        for (const button of device.config.buttons) {
            // Only poll buttons bound to this plugin
            if (!button.binding || button.binding.pluginId !== pluginId)
                continue;
            hasBoundButtons = true;
            const externalState = await pluginManager_1.pluginManager.getDeviceState(button.binding);
            if (!externalState) {
                console.log(`[StateSync] No state returned for button ${button.id} (${button.name})`);
                continue;
            }
            // Check if state changed
            const stateChanged = button.state !== externalState.state;
            const speedChanged = externalState.speedLevel !== undefined &&
                button.speedLevel !== externalState.speedLevel;
            if (stateChanged || speedChanged) {
                console.log(`[StateSync] State change detected: Button ${button.id} "${button.name}": ${button.state} -> ${externalState.state}`);
                // Update local state
                button.state = externalState.state;
                if (externalState.speedLevel !== undefined) {
                    button.speedLevel = externalState.speedLevel;
                }
                // Only include speedLevel for fan-type buttons
                const update = {
                    id: button.id,
                    state: externalState.state
                };
                if (button.type === 'fan' && externalState.speedLevel !== undefined) {
                    update.speedLevel = externalState.speedLevel;
                }
                buttonUpdates.push(update);
                hasChanges = true;
            }
        }
        // If we have changes, push them
        if (hasChanges) {
            const pushed = await (0, deviceService_1.pushButtonStatesToDevice)(device, buttonUpdates);
            if (pushed) {
                (0, db_1.upsertDevice)(device);
                lastPushTime.set(device.id, now);
                console.log(`[StateSync] Pushed ${buttonUpdates.length} changed state(s) to ${device.name}`);
            }
        }
        // If no changes but device has bound buttons and needs heartbeat, force push all states
        else if (hasBoundButtons && shouldForcePush(device.id, now)) {
            await pushAllStatesToDevice(device);
            // Also save to ensure database is in sync
            (0, db_1.upsertDevice)(device);
        }
    }
}
// Get all unique plugin IDs from device bindings
function getBoundPluginIds() {
    const pluginIds = new Set();
    const devices = (0, db_1.getAllDevices)();
    for (const device of devices) {
        for (const button of device.config.buttons) {
            if (button.binding?.pluginId) {
                pluginIds.add(button.binding.pluginId);
            }
        }
    }
    return pluginIds;
}
// Main tick function - checks which plugins need polling
async function pollTick() {
    const now = Date.now();
    const boundPlugins = getBoundPluginIds();
    for (const pluginId of boundPlugins) {
        if (shouldPollPlugin(pluginId, now)) {
            try {
                await pollPluginDevices(pluginId);
                lastPollTime.set(pluginId, now);
            }
            catch (error) {
                console.error(`[StateSync] Error polling plugin ${pluginId}:`, error);
            }
        }
    }
}
// Initial sync - poll all plugins and push states to all devices immediately
async function initialSync() {
    console.log('[StateSync] Performing initial sync...');
    const devices = (0, db_1.getAllDevices)();
    const boundPlugins = getBoundPluginIds();
    const now = Date.now();
    // First, poll all plugins to get current external states
    for (const pluginId of boundPlugins) {
        console.log(`[StateSync] Initial poll for plugin: ${pluginId}`);
        try {
            const devicesToUpdate = (0, db_1.getAllDevices)();
            for (const device of devicesToUpdate) {
                if (!device.online)
                    continue;
                for (const button of device.config.buttons) {
                    if (!button.binding || button.binding.pluginId !== pluginId)
                        continue;
                    const externalState = await pluginManager_1.pluginManager.getDeviceState(button.binding);
                    if (externalState) {
                        // Update local state to match external
                        if (button.state !== externalState.state) {
                            console.log(`[StateSync] Initial sync: "${button.name}" ${button.state} -> ${externalState.state}`);
                            button.state = externalState.state;
                        }
                        if (externalState.speedLevel !== undefined && button.speedLevel !== externalState.speedLevel) {
                            button.speedLevel = externalState.speedLevel;
                        }
                    }
                }
                // Save any state updates
                (0, db_1.upsertDevice)(device);
            }
            lastPollTime.set(pluginId, now);
        }
        catch (error) {
            console.error(`[StateSync] Error during initial poll of ${pluginId}:`, error);
        }
    }
    // Then push all states to all online devices
    for (const device of devices) {
        if (!device.online) {
            console.log(`[StateSync] Skipping offline device for initial push: ${device.name}`);
            continue;
        }
        await pushAllStatesToDevice(device);
    }
    console.log('[StateSync] Initial sync complete');
}
// Start periodic state polling
function startStatePolling() {
    if (tickInterval)
        return;
    // Log polling intervals for each registered plugin
    const plugins = pluginManager_1.pluginManager.getAllPlugins();
    for (const plugin of plugins) {
        const interval = plugin.pollingInterval || DEFAULT_POLL_INTERVAL;
        console.log(`[StateSync] Plugin "${plugin.name}" polling interval: ${interval / 1000}s`);
    }
    console.log(`[StateSync] Force push interval: ${FORCE_PUSH_INTERVAL / 1000}s`);
    console.log(`[StateSync] Starting state polling (tick interval: ${TICK_INTERVAL / 1000}s)`);
    // Perform initial sync
    initialSync().catch(error => {
        console.error('[StateSync] Initial sync error:', error);
    });
    // Start the tick interval
    tickInterval = setInterval(() => {
        pollTick().catch(error => {
            console.error('[StateSync] Tick error:', error);
        });
    }, TICK_INTERVAL);
}
// Sync a specific device: poll external states and push to panel
async function syncDevice(device) {
    console.log(`[StateSync] Manual sync requested for ${device.name}`);
    const buttonUpdates = [];
    // Poll all bound buttons from their plugins
    for (const button of device.config.buttons) {
        if (!button.binding)
            continue;
        const externalState = await pluginManager_1.pluginManager.getDeviceState(button.binding);
        if (externalState) {
            // Update local state to match external
            const changed = button.state !== externalState.state ||
                (externalState.speedLevel !== undefined && button.speedLevel !== externalState.speedLevel);
            if (changed) {
                console.log(`[StateSync] Sync update: "${button.name}" ${button.state} -> ${externalState.state}`);
            }
            button.state = externalState.state;
            if (externalState.speedLevel !== undefined) {
                button.speedLevel = externalState.speedLevel;
            }
        }
        // Include all buttons in the update (not just changed ones)
        // Only include speedLevel for fan-type buttons
        const update = {
            id: button.id,
            state: button.state
        };
        if (button.type === 'fan') {
            update.speedLevel = button.speedLevel;
        }
        buttonUpdates.push(update);
    }
    // Save updated states to database
    (0, db_1.upsertDevice)(device);
    // Push all button states to the panel
    if (device.online && device.ip) {
        const pushed = await (0, deviceService_1.pushButtonStatesToDevice)(device, buttonUpdates);
        if (pushed) {
            lastPushTime.set(device.id, Date.now());
            console.log(`[StateSync] Manual sync complete: pushed ${buttonUpdates.length} button(s) to ${device.name}`);
            return { success: true, updatedButtons: buttonUpdates.length };
        }
        else {
            console.log(`[StateSync] Manual sync: failed to push to ${device.name}`);
            return { success: false, updatedButtons: 0 };
        }
    }
    else {
        console.log(`[StateSync] Manual sync: device ${device.name} is offline, states updated in DB only`);
        return { success: true, updatedButtons: buttonUpdates.length };
    }
}
// Stop state polling
function stopStatePolling() {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
        lastPollTime.clear();
        lastPushTime.clear();
        console.log('[StateSync] Stopped state polling');
    }
}
// Force immediate poll for a specific plugin (useful after config changes)
async function forcePluginPoll(pluginId) {
    console.log(`[StateSync] Force polling plugin: ${pluginId}`);
    await pollPluginDevices(pluginId);
    lastPollTime.set(pluginId, Date.now());
}
// Force push states to a specific device (useful after config changes)
async function forceDevicePush(deviceId) {
    const devices = (0, db_1.getAllDevices)();
    const device = devices.find(d => d.id === deviceId);
    if (device && device.online) {
        await pushAllStatesToDevice(device);
    }
}
//# sourceMappingURL=stateSyncService.js.map