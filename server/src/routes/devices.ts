import { Router, Request, Response } from 'express';
import {
  getAllDevices,
  getDevice,
  upsertDevice,
  deleteDevice as dbDeleteDevice,
  Device,
  ButtonBinding
} from '../db';
import {
  pushConfigToDevice,
  fetchDeviceState,
  updateDeviceConfig,
  captureDeviceScreenshot,
  getDeviceScreenshot,
  pushButtonStatesToDevice
} from '../services/deviceService';

const router = Router();

// GET /api/devices - List all adopted devices
router.get('/', (req: Request, res: Response) => {
  const devices = getAllDevices();
  res.json(devices.map(d => ({
    id: d.id,
    name: d.name,
    location: d.location,
    ip: d.ip,
    mac: d.mac,
    online: d.online,
    lastSeen: d.lastSeen,
    theme: d.config.display.theme,
    brightness: d.config.display.brightness,
    buttonCount: d.config.buttons.length,
    sceneCount: d.config.scenes.length
  })));
});

// GET /api/devices/:id - Get device details
router.get('/:id', (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  res.json(device);
});

// GET /api/devices/:id/config - Get device config (called by ESP32 on boot)
router.get('/:id/config', (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not registered' });
  }

  // Update last seen
  device.lastSeen = Date.now();
  device.online = true;

  res.json(device.config);
});

// PUT /api/devices/:id - Update device configuration
router.put('/:id', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const updated = updateDeviceConfig(req.params.id, req.body);
  if (!updated) {
    return res.status(500).json({ error: 'Failed to update device' });
  }

  res.json({ success: true, device: updated });
});

// POST /api/devices/:id/config - Push config to device
router.post('/:id/config', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  // If body contains config updates, apply them first
  if (Object.keys(req.body).length > 0) {
    updateDeviceConfig(req.params.id, req.body);
  }

  const success = await pushConfigToDevice(device);
  if (success) {
    // Also push current button states to the device
    const buttonUpdates = device.config.buttons.map(btn => ({
      id: btn.id,
      state: btn.state,
      speedLevel: btn.speedLevel
    }));
    await pushButtonStatesToDevice(device, buttonUpdates);

    res.json({ success: true, message: 'Config and states pushed to device' });
  } else {
    res.status(500).json({ success: false, error: 'Failed to push config to device' });
  }
});

// GET /api/devices/:id/state - Get device state
router.get('/:id/state', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const state = await fetchDeviceState(device);
  if (state) {
    res.json(state);
  } else {
    res.status(503).json({ error: 'Device offline or unreachable' });
  }
});

// POST /api/devices/:id/state - Push state to device (for external integrations)
router.post('/:id/state', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  try {
    const response = await fetch(`http://${device.ip}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to push state to device' });
    }
  } catch (error) {
    res.status(503).json({ error: 'Device offline or unreachable' });
  }
});

// DELETE /api/devices/:id - Remove device
router.delete('/:id', (req: Request, res: Response) => {
  const success = dbDeleteDevice(req.params.id);
  if (success) {
    res.json({ success: true, message: 'Device removed' });
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

// POST /api/devices/:id/screenshot/capture - Capture screenshot on device
router.post('/:id/screenshot/capture', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const success = await captureDeviceScreenshot(device);
  if (success) {
    res.json({ success: true, message: 'Screenshot captured' });
  } else {
    res.status(500).json({ error: 'Failed to capture screenshot' });
  }
});

// GET /api/devices/:id/screenshot - Get screenshot from device (proxy)
router.get('/:id/screenshot', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const screenshot = await getDeviceScreenshot(device);
  if (screenshot) {
    res.set('Content-Type', 'image/bmp');
    res.set('Content-Disposition', `inline; filename="${device.id}-screenshot.bmp"`);
    res.send(screenshot);
  } else {
    res.status(404).json({ error: 'No screenshot available or device offline' });
  }
});

// POST /api/devices/:id/brightness - Set brightness
router.post('/:id/brightness', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const { brightness } = req.body;
  if (typeof brightness !== 'number' || brightness < 0 || brightness > 100) {
    return res.status(400).json({ error: 'Brightness must be 0-100' });
  }

  try {
    const response = await fetch(`http://${device.ip}/api/brightness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness })
    });

    if (response.ok) {
      device.config.display.brightness = brightness;
      updateDeviceConfig(device.id, { display: { ...device.config.display, brightness } });
      res.json({ success: true, brightness });
    } else {
      res.status(500).json({ error: 'Failed to set brightness' });
    }
  } catch (error) {
    res.status(503).json({ error: 'Device offline or unreachable' });
  }
});

// POST /api/devices/:id/theme - Set theme
router.post('/:id/theme', async (req: Request, res: Response) => {
  const device = getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const { theme } = req.body;
  const validThemes = ['light_mode', 'neon_cyberpunk', 'dark_clean', 'lcars'];
  if (!validThemes.includes(theme)) {
    return res.status(400).json({ error: `Theme must be one of: ${validThemes.join(', ')}` });
  }

  try {
    const response = await fetch(`http://${device.ip}/api/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme })
    });

    if (response.ok) {
      device.config.display.theme = theme;
      updateDeviceConfig(device.id, { display: { ...device.config.display, theme } });
      res.json({ success: true, theme });
    } else {
      res.status(500).json({ error: 'Failed to set theme' });
    }
  } catch (error) {
    res.status(503).json({ error: 'Device offline or unreachable' });
  }
});

// ============================================================================
// Button Binding Endpoints
// ============================================================================

// GET /api/devices/:deviceId/buttons/:buttonId/binding - Get button binding
router.get('/:deviceId/buttons/:buttonId/binding', (req: Request, res: Response) => {
  const device = getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const buttonId = parseInt(req.params.buttonId);
  const button = device.config.buttons.find(b => b.id === buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Button not found' });
  }

  if (button.binding) {
    res.json(button.binding);
  } else {
    res.json(null);
  }
});

// POST /api/devices/:deviceId/buttons/:buttonId/binding - Create/update button binding
router.post('/:deviceId/buttons/:buttonId/binding', (req: Request, res: Response) => {
  const device = getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const buttonId = parseInt(req.params.buttonId);
  const button = device.config.buttons.find(b => b.id === buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Button not found' });
  }

  const { pluginId, externalDeviceId, deviceType, metadata } = req.body;

  if (!pluginId || !externalDeviceId || !deviceType) {
    return res.status(400).json({
      error: 'Missing required fields: pluginId, externalDeviceId, deviceType'
    });
  }

  const binding: ButtonBinding = {
    pluginId,
    externalDeviceId,
    deviceType,
    metadata: metadata || {}
  };

  button.binding = binding;
  upsertDevice(device);

  res.json({
    success: true,
    binding: button.binding
  });
});

// DELETE /api/devices/:deviceId/buttons/:buttonId/binding - Remove button binding
router.delete('/:deviceId/buttons/:buttonId/binding', (req: Request, res: Response) => {
  const device = getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const buttonId = parseInt(req.params.buttonId);
  const button = device.config.buttons.find(b => b.id === buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Button not found' });
  }

  if (button.binding) {
    delete button.binding;
    upsertDevice(device);
    res.json({ success: true, message: 'Binding removed' });
  } else {
    res.json({ success: true, message: 'No binding to remove' });
  }
});

export default router;
