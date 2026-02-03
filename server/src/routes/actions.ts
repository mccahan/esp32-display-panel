import { Router, Request, Response } from 'express';
import { getDevice, upsertDevice, getGlobalScene } from '../db';
import { pluginManager } from '../plugins/pluginManager';
import { pushButtonStatesToDevice } from '../services/deviceService';

const router = Router();

// Helper function to execute a scene by ID (built-in or global)
async function executeSceneById(
  sceneId: string,
  device: any,
  deviceId: string
): Promise<{ success: boolean; results: Array<{ device: string; success: boolean; error?: string }> }> {
  const results: Array<{ device: string; success: boolean; error?: string }> = [];

  // Handle built-in scenes (All On / All Off for this device)
  if (sceneId === '__builtin_all_on__' || sceneId === '__builtin_all_off__') {
    const targetState = sceneId === '__builtin_all_on__';
    console.log(`[Action] Executing built-in "${targetState ? 'All On' : 'All Off'}" for device ${deviceId}`);

    // Get all buttons with bindings on this device (excluding scene-type buttons)
    const boundButtons = device.config.buttons.filter((b: any) => b.binding && b.type !== 'scene');
    console.log(`[Action] Found ${boundButtons.length} bound buttons to control`);

    for (const button of boundButtons) {
      try {
        console.log(`[Action] -> ${button.name}: ${targetState ? 'ON' : 'OFF'}`);

        const result = await pluginManager.executeAction({
          deviceId,
          buttonId: button.id,
          binding: button.binding!,
          newState: targetState,
          speedLevel: targetState && button.type === 'fan' ? 1 : 0,
          timestamp: Date.now()
        });

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
      } catch (error: any) {
        console.error(`[Action] Error executing action for ${button.name}:`, error);
        results.push({ device: button.name, success: false, error: error.message });
      }
    }

    upsertDevice(device);
    return { success: results.every(r => r.success), results };
  }

  // Get the global scene definition
  const globalScene = getGlobalScene(sceneId);
  if (!globalScene) {
    console.log(`[Action] Global scene ${sceneId} not found`);
    return { success: false, results: [{ device: 'scene', success: false, error: 'Global scene not found' }] };
  }

  console.log(`[Action] Executing global scene "${globalScene.name}" with ${globalScene.actions.length} actions`);

  for (const action of globalScene.actions) {
    try {
      console.log(`[Action] -> ${action.deviceName}: ${action.targetState ? 'ON' : 'OFF'}`);

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
      console.error(`[Action] Error executing action for ${action.deviceName}:`, error);
      results.push({ device: action.deviceName, success: false, error: error.message });
    }
  }

  return { success: results.every(r => r.success), results };
}

// Helper function to handle button action with optional plugin routing
async function handleButtonAction(
  buttonId: number,
  deviceId: string,
  state: boolean,
  timestamp: number,
  speedLevel?: number
): Promise<{ success: boolean; state: boolean; error?: string }> {
  const device = getDevice(deviceId);
  if (!device) {
    return { success: false, state, error: 'Device not found' };
  }

  const button = device.config.buttons.find(b => b.id === buttonId);
  if (!button) {
    return { success: false, state, error: 'Button not found' };
  }

  // Handle scene-type buttons
  if (button.type === 'scene') {
    if (!button.sceneId) {
      console.log(`[Action] Scene button ${buttonId} has no scene assigned`);
      return { success: false, state: false, error: 'No scene assigned to button' };
    }

    console.log(`[Action] Scene button ${buttonId} "${button.name}" pressed, executing scene ${button.sceneId}`);
    const result = await executeSceneById(button.sceneId, device, deviceId);
    console.log(`[Action] Scene execution ${result.success ? 'completed' : 'completed with errors'}`);
    return { success: result.success, state: false };
  }

  // If button has a plugin binding, route through plugin system
  if (button.binding) {
    const result = await pluginManager.executeAction({
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
      upsertDevice(device);

      // Push updated state to the ESP32 panel
      if (device.ip && device.online) {
        const buttonUpdate = { id: buttonId, state: button.state, speedLevel: button.speedLevel };
        pushButtonStatesToDevice(device, [buttonUpdate]).catch(err => {
          console.error(`[Action] Failed to push state to device ${device.name}:`, err);
        });
      }

      return { success: true, state: button.state };
    } else {
      console.error(`[Action] Plugin action failed: ${result.error}`);
      return { success: false, state: button.state, error: result.error };
    }
  }

  // Legacy behavior for buttons without bindings
  button.state = state;
  if (speedLevel !== undefined) {
    button.speedLevel = speedLevel;
  }
  upsertDevice(device);

  // Push updated state to the ESP32 panel
  if (device.ip && device.online) {
    const buttonUpdate = { id: buttonId, state: button.state, speedLevel: button.speedLevel };
    pushButtonStatesToDevice(device, [buttonUpdate]).catch(err => {
      console.error(`[Action] Failed to push state to device ${device.name}:`, err);
    });
  }

  return { success: true, state };
}

// POST /api/action/light/:buttonId - Light button pressed (called by ESP32)
router.post('/light/:buttonId', async (req: Request, res: Response) => {
  const buttonId = parseInt(req.params.buttonId);
  const { deviceId, state, timestamp } = req.body;

  console.log(`[Action] Light ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);

  const result = await handleButtonAction(buttonId, deviceId, state, timestamp);
  res.json({ buttonId, ...result });
});

// POST /api/action/switch/:buttonId - Switch button pressed (called by ESP32)
router.post('/switch/:buttonId', async (req: Request, res: Response) => {
  const buttonId = parseInt(req.params.buttonId);
  const { deviceId, state, timestamp } = req.body;

  console.log(`[Action] Switch ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}`);

  const result = await handleButtonAction(buttonId, deviceId, state, timestamp);
  res.json({ buttonId, ...result });
});

// POST /api/action/fan/:buttonId - Fan button pressed (called by ESP32)
router.post('/fan/:buttonId', async (req: Request, res: Response) => {
  const buttonId = parseInt(req.params.buttonId);
  const { deviceId, state, speedLevel, timestamp } = req.body;

  console.log(`[Action] Fan ${buttonId} on device ${deviceId} -> ${state ? 'ON' : 'OFF'}, speed: ${speedLevel}`);

  const result = await handleButtonAction(buttonId, deviceId, state, timestamp, speedLevel);
  res.json({ buttonId, speedLevel, ...result });
});

// POST /api/action/scene/:sceneId - Scene activated (called by ESP32 scene buttons)
router.post('/scene/:sceneId', async (req: Request, res: Response) => {
  const sceneId = parseInt(req.params.sceneId);
  const { deviceId, timestamp } = req.body;

  console.log(`[Action] Scene ${sceneId} activated on device ${deviceId}`);

  const device = getDevice(deviceId);
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

  // Use shared scene execution function
  const result = await executeSceneById(deviceScene.globalSceneId, device, deviceId);

  res.json({
    success: result.success,
    sceneId,
    sceneName: deviceScene.name,
    results: result.results
  });
});

// GET /api/ping - Simple ping endpoint for connectivity check
router.get('/ping', (req: Request, res: Response) => {
  res.json({ pong: true, timestamp: Date.now() });
});

export default router;
