import { Router, Request, Response } from 'express';
import { getDevice, getAllDevices } from '../db';

const router = Router();

// POST /api/action/light/:buttonId - Light button pressed (called by ESP32)
router.post('/light/:buttonId', (req: Request, res: Response) => {
  const buttonId = parseInt(req.params.buttonId);
  const { deviceId, state, timestamp } = req.body;

  console.log(`[Action] Light ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);

  // Update device config state (optional, device already tracks this)
  const device = getDevice(deviceId);
  if (device) {
    const button = device.config.buttons.find(b => b.id === buttonId);
    if (button) {
      button.state = state;
    }
  }

  // Here you would trigger any automations, webhooks to Home Assistant, etc.
  // For now, just acknowledge
  res.json({ success: true, buttonId, state });
});

// POST /api/action/switch/:buttonId - Switch button pressed (called by ESP32)
router.post('/switch/:buttonId', (req: Request, res: Response) => {
  const buttonId = parseInt(req.params.buttonId);
  const { deviceId, state, timestamp } = req.body;

  console.log(`[Action] Switch ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);

  const device = getDevice(deviceId);
  if (device) {
    const button = device.config.buttons.find(b => b.id === buttonId);
    if (button) {
      button.state = state;
    }
  }

  res.json({ success: true, buttonId, state });
});

// POST /api/action/scene/:sceneId - Scene activated (called by ESP32)
router.post('/scene/:sceneId', (req: Request, res: Response) => {
  const sceneId = parseInt(req.params.sceneId);
  const { deviceId, timestamp } = req.body;

  console.log(`[Action] Scene ${sceneId} activated on device ${deviceId}`);

  const device = getDevice(deviceId);
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
router.get('/ping', (req: Request, res: Response) => {
  res.json({ pong: true, timestamp: Date.now() });
});

export default router;
