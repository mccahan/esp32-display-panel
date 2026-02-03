import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { pluginManager } from '../plugins/pluginManager';
import timedDevicesPlugin from '../plugins/timed-devices';

const router = Router();

// =============================================
// Timed Devices Plugin Routes
// IMPORTANT: These must be defined BEFORE generic /:id routes
// =============================================

// GET /api/plugins/timed-devices/timed-devices - Get all timed device configs
router.get('/timed-devices/timed-devices', (req: Request, res: Response) => {
  try {
    const timedDevices = timedDevicesPlugin.getTimedDeviceConfigs();
    res.json(timedDevices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plugins/timed-devices/source-devices - Discover devices from other plugins
router.get('/timed-devices/source-devices', async (req: Request, res: Response) => {
  try {
    const devices = await timedDevicesPlugin.discoverSourceDevices();
    res.json(devices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/plugins/timed-devices/timed-devices - Create a new timed device
router.post('/timed-devices/timed-devices', async (req: Request, res: Response) => {
  try {
    const { name, icon, actionType, durationMinutes, targetDevices } = req.body;

    if (!name || !actionType || !durationMinutes || !targetDevices || targetDevices.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const timedDevice = await timedDevicesPlugin.createTimedDevice({
      name,
      icon: icon || 'timer',
      actionType,
      durationMinutes,
      targetDevices
    });

    res.json(timedDevice);
  } catch (error: any) {
    console.error('Failed to create timed device:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/plugins/timed-devices/timed-devices/:timedDeviceId - Update a timed device
router.put('/timed-devices/timed-devices/:timedDeviceId', async (req: Request, res: Response) => {
  try {
    const { name, icon, actionType, durationMinutes, targetDevices } = req.body;

    const updated = await timedDevicesPlugin.updateTimedDevice(req.params.timedDeviceId, {
      name,
      icon,
      actionType,
      durationMinutes,
      targetDevices
    });

    if (!updated) {
      return res.status(404).json({ error: 'Timed device not found' });
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Failed to update timed device:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/plugins/timed-devices/timed-devices/:timedDeviceId - Delete a timed device
router.delete('/timed-devices/timed-devices/:timedDeviceId', async (req: Request, res: Response) => {
  try {
    const deleted = await timedDevicesPlugin.deleteTimedDevice(req.params.timedDeviceId);

    if (!deleted) {
      return res.status(404).json({ error: 'Timed device not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete timed device:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plugins/timed-devices/jobs - Get all scheduled jobs
router.get('/timed-devices/jobs', (req: Request, res: Response) => {
  try {
    const jobs = timedDevicesPlugin.getScheduledJobs();
    res.json(jobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plugins/timed-devices/jobs/active - Get active jobs only
router.get('/timed-devices/jobs/active', (req: Request, res: Response) => {
  try {
    const jobs = timedDevicesPlugin.getActiveJobs();
    res.json(jobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/plugins/timed-devices/jobs/:jobId - Cancel a job
router.delete('/timed-devices/jobs/:jobId', (req: Request, res: Response) => {
  try {
    const cancelled = timedDevicesPlugin.cancelJob(req.params.jobId);

    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found or already completed' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// Generic Plugin Routes
// =============================================

// GET /api/plugins/:id/ui - Get plugin configuration UI
router.get('/:id/ui', (req: Request, res: Response) => {
  const pluginId = req.params.id;
  const plugin = pluginManager.getPlugin(pluginId);

  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  // Look for UI file in plugin directory (in src/, not dist/)
  const uiPath = path.join(__dirname, '../../src/plugins', pluginId, 'ui', 'config.html');

  if (!fs.existsSync(uiPath)) {
    // No custom UI - return empty
    return res.json({ hasUI: false });
  }

  try {
    const content = fs.readFileSync(uiPath, 'utf-8');
    res.json({ hasUI: true, content });
  } catch (error: any) {
    console.error(`Failed to load plugin UI for ${pluginId}:`, error);
    res.status(500).json({ error: 'Failed to load plugin UI' });
  }
});

// GET /api/plugins - List all plugins with status
router.get('/', (req: Request, res: Response) => {
  const plugins = pluginManager.getAllPlugins();
  const result = plugins.map(plugin => {
    const config = pluginManager.getPluginConfig(plugin.id);
    return {
      id: plugin.id,
      name: plugin.name,
      type: plugin.type,
      description: plugin.description,
      enabled: config?.enabled || false,
      hasDeviceDiscovery: !!plugin.discoverDevices,
      hasActionHandler: !!plugin.executeAction,
      hasConnectionTest: !!plugin.testConnection
    };
  });
  res.json(result);
});

// GET /api/plugins/:id - Get plugin details and config
router.get('/:id', (req: Request, res: Response) => {
  const plugin = pluginManager.getPlugin(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  const config = pluginManager.getPluginConfig(plugin.id);
  res.json({
    id: plugin.id,
    name: plugin.name,
    type: plugin.type,
    description: plugin.description,
    enabled: config?.enabled || false,
    settings: config?.settings || {},
    hasDeviceDiscovery: !!plugin.discoverDevices,
    hasActionHandler: !!plugin.executeAction,
    hasConnectionTest: !!plugin.testConnection
  });
});

// PUT /api/plugins/:id - Update plugin configuration
router.put('/:id', async (req: Request, res: Response) => {
  const plugin = pluginManager.getPlugin(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  try {
    const { enabled, settings } = req.body;
    // Only include settings if explicitly provided to avoid overwriting existing settings
    const configUpdate: { enabled?: boolean; settings?: Record<string, any> } = {};
    if (enabled !== undefined) configUpdate.enabled = enabled;
    if (settings !== undefined) configUpdate.settings = settings;
    await pluginManager.setPluginConfig(req.params.id, configUpdate);

    const config = pluginManager.getPluginConfig(plugin.id);
    res.json({
      success: true,
      config: {
        id: plugin.id,
        name: plugin.name,
        enabled: config?.enabled || false,
        settings: config?.settings || {}
      }
    });
  } catch (error: any) {
    console.error('Failed to update plugin config:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plugins/:id/devices - Discover devices from plugin
router.get('/:id/devices', async (req: Request, res: Response) => {
  const plugin = pluginManager.getPlugin(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  if (!plugin.discoverDevices) {
    return res.status(400).json({ error: 'Plugin does not support device discovery' });
  }

  try {
    const devices = await pluginManager.discoverDevices(req.params.id);
    res.json(devices);
  } catch (error: any) {
    console.error('Device discovery failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/plugins/:id/test - Test plugin connection
router.post('/:id/test', async (req: Request, res: Response) => {
  const plugin = pluginManager.getPlugin(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  try {
    // If settings are provided in the body, temporarily update them for the test
    if (req.body.settings) {
      const currentConfig = pluginManager.getPluginConfig(req.params.id);
      await pluginManager.setPluginConfig(req.params.id, {
        enabled: currentConfig?.enabled || false,
        settings: req.body.settings
      });
    }

    const result = await pluginManager.testConnection(req.params.id);
    res.json(result);
  } catch (error: any) {
    console.error('Connection test failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
