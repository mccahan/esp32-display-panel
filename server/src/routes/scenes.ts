import { Router, Request, Response } from 'express';
import {
  getAllGlobalScenes,
  getGlobalScene,
  upsertGlobalScene,
  deleteGlobalScene,
  generateSceneId,
  GlobalScene,
  SceneAction
} from '../db';
import { pluginManager } from '../plugins/pluginManager';

const router = Router();

// GET /api/scenes - List all global scenes
router.get('/', (req: Request, res: Response) => {
  const scenes = getAllGlobalScenes();
  res.json(scenes);
});

// GET /api/scenes/:id - Get scene by ID
router.get('/:id', (req: Request, res: Response) => {
  const scene = getGlobalScene(req.params.id);
  if (!scene) {
    return res.status(404).json({ error: 'Scene not found' });
  }
  res.json(scene);
});

// POST /api/scenes - Create new scene
router.post('/', (req: Request, res: Response) => {
  const { name, icon, actions } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Scene name is required' });
  }

  const scene: GlobalScene = {
    id: generateSceneId(),
    name,
    icon: icon || 'power',
    actions: actions || [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  upsertGlobalScene(scene);
  res.status(201).json(scene);
});

// PUT /api/scenes/:id - Update scene
router.put('/:id', (req: Request, res: Response) => {
  const existing = getGlobalScene(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Scene not found' });
  }

  const { name, icon, actions } = req.body;

  const updated: GlobalScene = {
    ...existing,
    name: name || existing.name,
    icon: icon || existing.icon,
    actions: actions !== undefined ? actions : existing.actions,
    updatedAt: Date.now()
  };

  upsertGlobalScene(updated);
  res.json(updated);
});

// DELETE /api/scenes/:id - Delete scene
router.delete('/:id', (req: Request, res: Response) => {
  const success = deleteGlobalScene(req.params.id);
  if (success) {
    res.json({ success: true, message: 'Scene deleted' });
  } else {
    res.status(404).json({ error: 'Scene not found' });
  }
});

// POST /api/scenes/:id/execute - Execute a scene
router.post('/:id/execute', async (req: Request, res: Response) => {
  const scene = getGlobalScene(req.params.id);
  if (!scene) {
    return res.status(404).json({ error: 'Scene not found' });
  }

  const results: Array<{ device: string; success: boolean; error?: string }> = [];

  for (const action of scene.actions) {
    try {
      const result = await pluginManager.executeAction({
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
    } catch (error: any) {
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
router.get('/available/devices', async (req: Request, res: Response) => {
  const allDevices: Array<{
    pluginId: string;
    pluginName: string;
    device: any;
  }> = [];

  const plugins = pluginManager.getAllPlugins();

  for (const plugin of plugins) {
    const config = pluginManager.getPluginConfig(plugin.id);
    if (!config?.enabled || !plugin.discoverDevices) continue;

    try {
      const devices = await plugin.discoverDevices();
      for (const device of devices) {
        allDevices.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          device
        });
      }
    } catch (error) {
      console.error(`Failed to discover devices from ${plugin.name}:`, error);
    }
  }

  res.json(allDevices);
});

export default router;
