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
router.post('/scene/:sceneId', (req, res) => {
    const sceneId = parseInt(req.params.sceneId);
    const { deviceId, timestamp } = req.body;
    console.log(`[Action] Scene ${sceneId} activated on device ${deviceId}`);
    const device = (0, db_1.getDevice)(deviceId);
    if (device) {
        const scene = device.config.scenes.find(s => s.id === sceneId);
        if (scene) {
            console.log(`[Action] Scene name: ${scene.name}`);
        }
    }
    // Here you would trigger scene automations
    res.json({ success: true, sceneId });
});
// GET /api/ping - Simple ping endpoint for connectivity check
router.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
});
exports.default = router;
//# sourceMappingURL=actions.js.map