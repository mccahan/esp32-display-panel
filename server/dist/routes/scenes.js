"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const pluginManager_1 = require("../plugins/pluginManager");
const router = (0, express_1.Router)();
// GET /api/scenes - List all global scenes
router.get('/', (req, res) => {
    const scenes = (0, db_1.getAllGlobalScenes)();
    res.json(scenes);
});
// GET /api/scenes/:id - Get scene by ID
router.get('/:id', (req, res) => {
    const scene = (0, db_1.getGlobalScene)(req.params.id);
    if (!scene) {
        return res.status(404).json({ error: 'Scene not found' });
    }
    res.json(scene);
});
// POST /api/scenes - Create new scene
router.post('/', (req, res) => {
    const { name, icon, actions } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Scene name is required' });
    }
    const scene = {
        id: (0, db_1.generateSceneId)(),
        name,
        icon: icon || 'power',
        actions: actions || [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    (0, db_1.upsertGlobalScene)(scene);
    res.status(201).json(scene);
});
// PUT /api/scenes/:id - Update scene
router.put('/:id', (req, res) => {
    const existing = (0, db_1.getGlobalScene)(req.params.id);
    if (!existing) {
        return res.status(404).json({ error: 'Scene not found' });
    }
    const { name, icon, actions } = req.body;
    const updated = {
        ...existing,
        name: name || existing.name,
        icon: icon || existing.icon,
        actions: actions !== undefined ? actions : existing.actions,
        updatedAt: Date.now()
    };
    (0, db_1.upsertGlobalScene)(updated);
    res.json(updated);
});
// DELETE /api/scenes/:id - Delete scene
router.delete('/:id', (req, res) => {
    const success = (0, db_1.deleteGlobalScene)(req.params.id);
    if (success) {
        res.json({ success: true, message: 'Scene deleted' });
    }
    else {
        res.status(404).json({ error: 'Scene not found' });
    }
});
// POST /api/scenes/:id/execute - Execute a scene
router.post('/:id/execute', async (req, res) => {
    const scene = (0, db_1.getGlobalScene)(req.params.id);
    if (!scene) {
        return res.status(404).json({ error: 'Scene not found' });
    }
    const results = [];
    for (const action of scene.actions) {
        try {
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
        }
        catch (error) {
            results.push({
                device: action.deviceName,
                success: false,
                error: error.message
            });
        }
    }
    const allSuccess = results.every(r => r.success);
    res.json({
        success: allSuccess,
        scene: scene.name,
        results
    });
});
// GET /api/scenes/available-devices - Get all devices from all plugins for scene configuration
router.get('/available/devices', async (req, res) => {
    const allDevices = [];
    const plugins = pluginManager_1.pluginManager.getAllPlugins();
    for (const plugin of plugins) {
        const config = pluginManager_1.pluginManager.getPluginConfig(plugin.id);
        if (!config?.enabled || !plugin.discoverDevices)
            continue;
        try {
            const devices = await plugin.discoverDevices();
            for (const device of devices) {
                allDevices.push({
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    device
                });
            }
        }
        catch (error) {
            console.error(`Failed to discover devices from ${plugin.name}:`, error);
        }
    }
    res.json(allDevices);
});
exports.default = router;
//# sourceMappingURL=scenes.js.map