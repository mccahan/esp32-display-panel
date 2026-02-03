import { Router, Request, Response } from 'express';
import { pluginManager } from '../plugins/pluginManager';

const router = Router();

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
    await pluginManager.setPluginConfig(req.params.id, { enabled, settings });

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
