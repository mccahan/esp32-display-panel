"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollAllBoundDevices = pollAllBoundDevices;
exports.startStatePolling = startStatePolling;
exports.stopStatePolling = stopStatePolling;
const db_1 = require("../db");
const pluginManager_1 = require("../plugins/pluginManager");
const deviceService_1 = require("./deviceService");
let pollInterval = null;
// Poll all bound devices for external state changes
async function pollAllBoundDevices() {
    const devices = (0, db_1.getAllDevices)();
    for (const device of devices) {
        if (!device.online)
            continue;
        const buttonUpdates = [];
        let hasChanges = false;
        for (const button of device.config.buttons) {
            if (!button.binding)
                continue;
            const externalState = await pluginManager_1.pluginManager.getDeviceState(button.binding);
            if (!externalState)
                continue;
            // Check if state changed
            const stateChanged = button.state !== externalState.state;
            const speedChanged = externalState.speedLevel !== undefined &&
                button.speedLevel !== externalState.speedLevel;
            if (stateChanged || speedChanged) {
                // Update local state
                button.state = externalState.state;
                if (externalState.speedLevel !== undefined) {
                    button.speedLevel = externalState.speedLevel;
                }
                buttonUpdates.push({
                    id: button.id,
                    state: externalState.state,
                    speedLevel: externalState.speedLevel
                });
                hasChanges = true;
            }
        }
        if (hasChanges) {
            // Push to ESP32 device
            const pushed = await (0, deviceService_1.pushButtonStatesToDevice)(device, buttonUpdates);
            if (pushed) {
                // Save to database
                (0, db_1.upsertDevice)(device);
                console.log(`[StateSync] Pushed ${buttonUpdates.length} update(s) to ${device.name}`);
            }
        }
    }
}
// Start periodic state polling
function startStatePolling(intervalMs = 30000) {
    if (pollInterval)
        return;
    console.log(`Starting state polling every ${intervalMs / 1000} seconds`);
    pollInterval = setInterval(() => {
        pollAllBoundDevices().catch(error => {
            console.error('[StateSync] Polling error:', error);
        });
    }, intervalMs);
    // Run immediately on start
    pollAllBoundDevices().catch(error => {
        console.error('[StateSync] Initial polling error:', error);
    });
}
// Stop state polling
function stopStatePolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('Stopped state polling');
    }
}
//# sourceMappingURL=stateSyncService.js.map