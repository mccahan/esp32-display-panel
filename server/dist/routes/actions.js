"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const pluginManager_1 = require("../plugins/pluginManager");
const router = (0, express_1.Router)();
// Helper function to handle button action with optional plugin routing
async function handleButtonAction(buttonId, deviceId, state, timestamp, speedLevel) {
    const device = (0, db_1.getDevice)(deviceId);
    if (!device) {
        return { success: false, state, error: 'Device not found' };
    }
    const button = device.config.buttons.find(b => b.id === buttonId);
    if (!button) {
        return { success: false, state, error: 'Button not found' };
    }
    // If button has a plugin binding, route through plugin system
    if (button.binding) {
        const result = await pluginManager_1.pluginManager.executeAction({
            deviceId,
            buttonId,
            binding: button.binding,
            newState: state,
            speedLevel,
            timestamp
        });
        if (result.success) {
            // Update local state based on plugin result
            button.state = result.newState !== undefined ? result.newState : state;
            if (speedLevel !== undefined) {
                button.speedLevel = speedLevel;
            }
            (0, db_1.upsertDevice)(device);
            return { success: true, state: button.state };
        }
        else {
            console.error(`[Action] Plugin action failed: ${result.error}`);
            return { success: false, state: button.state, error: result.error };
        }
    }
    // Legacy behavior for buttons without bindings
    button.state = state;
    if (speedLevel !== undefined) {
        button.speedLevel = speedLevel;
    }
    (0, db_1.upsertDevice)(device);
    return { success: true, state };
}
// POST /api/action/light/:buttonId - Light button pressed (called by ESP32)
router.post('/light/:buttonId', async (req, res) => {
    const buttonId = parseInt(req.params.buttonId);
    const { deviceId, state, timestamp } = req.body;
    console.log(`[Action] Light ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);
    const result = await handleButtonAction(buttonId, deviceId, state, timestamp);
    res.json({ buttonId, ...result });
});
// POST /api/action/switch/:buttonId - Switch button pressed (called by ESP32)
router.post('/switch/:buttonId', async (req, res) => {
    const buttonId = parseInt(req.params.buttonId);
    const { deviceId, state, timestamp } = req.body;
    console.log(`[Action] Switch ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);
    const result = await handleButtonAction(buttonId, deviceId, state, timestamp);
    res.json({ buttonId, ...result });
});
// POST /api/action/fan/:buttonId - Fan button pressed (called by ESP32)
router.post('/fan/:buttonId', async (req, res) => {
    const buttonId = parseInt(req.params.buttonId);
    const { deviceId, state, speedLevel, timestamp } = req.body;
    console.log(`[Action] Fan ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}, speed: ${speedLevel}`);
    const result = await handleButtonAction(buttonId, deviceId, state, timestamp, speedLevel);
    res.json({ buttonId, speedLevel, ...result });
});
// POST /api/action/scene/:sceneId - Scene activated (called by ESP32)
router.post('/scene/:sceneId', async (req, res) => {
    const sceneId = parseInt(req.params.sceneId);
    const { deviceId, timestamp } = req.body;
    console.log(`[Action] Scene ${sceneId} activated on device ${deviceId}`);
    const device = (0, db_1.getDevice)(deviceId);
    if (!device) {
        return res.status(404).json({ success: false, error: 'Device not found' });
    }
    const deviceScene = device.config.scenes.find(s => s.id === sceneId);
    if (!deviceScene) {
        return res.status(404).json({ success: false, error: 'Scene not found on device' });
    }
    console.log(`[Action] Scene name: ${deviceScene.name}`);
    // Check if this device scene references a global scene
    if (!deviceScene.globalSceneId) {
        console.log(`[Action] Scene "${deviceScene.name}" has no global scene reference, skipping execution`);
        return res.json({ success: true, sceneId, message: 'No global scene linked' });
    }
    const results = [];
    // Handle built-in scenes (All On / All Off for this device)
    if (deviceScene.globalSceneId === '__builtin_all_on__' || deviceScene.globalSceneId === '__builtin_all_off__') {
        const targetState = deviceScene.globalSceneId === '__builtin_all_on__';
        console.log(`[Action] Executing built-in "${targetState ? 'All On' : 'All Off'}" for device ${deviceId}`);
        // Get all buttons with bindings on this device
        const boundButtons = device.config.buttons.filter(b => b.binding);
        console.log(`[Action] Found ${boundButtons.length} bound buttons to control`);
        for (const button of boundButtons) {
            try {
                console.log(`[Action] -> ${button.name}: ${targetState ? 'ON' : 'OFF'}`);
                const result = await pluginManager_1.pluginManager.executeAction({
                    deviceId,
                    buttonId: button.id,
                    binding: button.binding,
                    newState: targetState,
                    speedLevel: targetState && button.type === 'fan' ? 1 : 0,
                    timestamp: Date.now()
                });
                // Update local button state
                if (result.success) {
                    button.state = targetState;
                    if (button.type === 'fan') {
                        button.speedLevel = targetState ? 1 : 0;
                    }
                }
                results.push({
                    device: button.name,
                    success: result.success,
                    error: result.error
                });
                if (!result.success) {
                    console.error(`[Action] Failed to execute action for ${button.name}: ${result.error}`);
                }
            }
            catch (error) {
                console.error(`[Action] Error executing action for ${button.name}:`, error);
                results.push({
                    device: button.name,
                    success: false,
                    error: error.message
                });
            }
        }
        // Save updated button states
        (0, db_1.upsertDevice)(device);
        const allSuccess = results.every(r => r.success);
        console.log(`[Action] Built-in scene execution ${allSuccess ? 'completed' : 'completed with errors'}`);
        return res.json({
            success: allSuccess,
            sceneId,
            sceneName: deviceScene.name,
            results
        });
    }
    // Get the global scene definition
    const globalScene = (0, db_1.getGlobalScene)(deviceScene.globalSceneId);
    if (!globalScene) {
        console.log(`[Action] Global scene ${deviceScene.globalSceneId} not found`);
        return res.status(404).json({ success: false, error: 'Global scene not found' });
    }
    console.log(`[Action] Executing global scene "${globalScene.name}" with ${globalScene.actions.length} actions`);
    // Execute all actions in the scene
    for (const action of globalScene.actions) {
        try {
            console.log(`[Action] -> ${action.deviceName}: ${action.targetState ? 'ON' : 'OFF'}${action.targetSpeedLevel !== undefined ? ` (speed ${action.targetSpeedLevel})` : ''}`);
            const result = await pluginManager_1.pluginManager.executeAction({
                deviceId: 'scene-execution',
                buttonId: 0,
                binding: {
                    pluginId: action.pluginId,
                    externalDeviceId: action.externalDeviceId,
                    deviceType: action.deviceType,
                    metadata: {}
                },
                newState: action.targetState,
                speedLevel: action.targetSpeedLevel,
                timestamp: Date.now()
            });
            results.push({
                device: action.deviceName,
                success: result.success,
                error: result.error
            });
            if (!result.success) {
                console.error(`[Action] Failed to execute action for ${action.deviceName}: ${result.error}`);
            }
        }
        catch (error) {
            console.error(`[Action] Error executing action for ${action.deviceName}:`, error);
            results.push({
                device: action.deviceName,
                success: false,
                error: error.message
            });
        }
    }
    const allSuccess = results.every(r => r.success);
    console.log(`[Action] Scene "${globalScene.name}" execution ${allSuccess ? 'completed' : 'completed with errors'}`);
    res.json({
        success: allSuccess,
        sceneId,
        sceneName: globalScene.name,
        results
    });
});
// GET /api/ping - Simple ping endpoint for connectivity check
router.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
});
exports.default = router;
//# sourceMappingURL=actions.js.map