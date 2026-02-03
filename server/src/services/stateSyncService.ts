import { getAllDevices, upsertDevice, Device, ButtonConfig } from '../db';
import { pluginManager } from '../plugins/pluginManager';
import { pushButtonStatesToDevice } from './deviceService';

const DEFAULT_POLL_INTERVAL = 30000;  // 30 seconds default
const TICK_INTERVAL = 5000;           // Check every 5 seconds which plugins need polling
const FORCE_PUSH_INTERVAL = 60000;    // Force push states every 60 seconds even if unchanged

let tickInterval: NodeJS.Timeout | null = null;
const lastPollTime: Map<string, number> = new Map();
const lastPushTime: Map<string, number> = new Map();  // Track last push per device

// Get the polling interval for a plugin
function getPluginPollingInterval(pluginId: string): number {
  const plugin = pluginManager.getPlugin(pluginId);
  return plugin?.pollingInterval || DEFAULT_POLL_INTERVAL;
}

// Check if a plugin is due for polling
function shouldPollPlugin(pluginId: string, now: number): boolean {
  const lastPoll = lastPollTime.get(pluginId) || 0;
  const interval = getPluginPollingInterval(pluginId);
  return (now - lastPoll) >= interval;
}

// Check if a device needs a forced state push (heartbeat)
function shouldForcePush(deviceId: string, now: number): boolean {
  const lastPush = lastPushTime.get(deviceId) || 0;
  return (now - lastPush) >= FORCE_PUSH_INTERVAL;
}

// Push all button states to a device (regardless of changes)
async function pushAllStatesToDevice(device: Device): Promise<boolean> {
  const buttonUpdates = device.config.buttons.map(btn => {
    const update: { id: number; state: boolean; speedLevel?: number } = {
      id: btn.id,
      state: btn.state
    };
    // Only include speedLevel for fan-type buttons
    if (btn.type === 'fan') {
      update.speedLevel = btn.speedLevel;
    }
    return update;
  });

  console.log(`[StateSync] Force pushing ${buttonUpdates.length} button states to ${device.name}`);
  const success = await pushButtonStatesToDevice(device, buttonUpdates);

  if (success) {
    lastPushTime.set(device.id, Date.now());
  }

  return success;
}

// Poll devices bound to a specific plugin
async function pollPluginDevices(pluginId: string): Promise<void> {
  const devices = getAllDevices();
  const now = Date.now();

  for (const device of devices) {
    if (!device.online) {
      continue;
    }

    const buttonUpdates: Array<{ id: number; state: boolean; speedLevel?: number }> = [];
    let hasChanges = false;
    let hasBoundButtons = false;

    for (const button of device.config.buttons) {
      // Only poll buttons bound to this plugin
      if (!button.binding || button.binding.pluginId !== pluginId) continue;
      hasBoundButtons = true;

      const externalState = await pluginManager.getDeviceState(button.binding);
      if (!externalState) {
        console.log(`[StateSync] No state returned for button ${button.id} (${button.name})`);
        continue;
      }

      // Check if state changed
      const stateChanged = button.state !== externalState.state;
      const speedChanged = externalState.speedLevel !== undefined &&
                          button.speedLevel !== externalState.speedLevel;

      if (stateChanged || speedChanged) {
        console.log(`[StateSync] State change detected: Button ${button.id} "${button.name}": ${button.state} -> ${externalState.state}`);

        // Update local state
        button.state = externalState.state;
        if (externalState.speedLevel !== undefined) {
          button.speedLevel = externalState.speedLevel;
        }

        // Only include speedLevel for fan-type buttons
        const update: { id: number; state: boolean; speedLevel?: number } = {
          id: button.id,
          state: externalState.state
        };
        if (button.type === 'fan' && externalState.speedLevel !== undefined) {
          update.speedLevel = externalState.speedLevel;
        }
        buttonUpdates.push(update);
        hasChanges = true;
      }
    }

    // If we have changes, push them
    if (hasChanges) {
      const pushed = await pushButtonStatesToDevice(device, buttonUpdates);
      if (pushed) {
        upsertDevice(device);
        lastPushTime.set(device.id, now);
        console.log(`[StateSync] Pushed ${buttonUpdates.length} changed state(s) to ${device.name}`);
      }
    }
    // If no changes but device has bound buttons and needs heartbeat, force push all states
    else if (hasBoundButtons && shouldForcePush(device.id, now)) {
      await pushAllStatesToDevice(device);
      // Also save to ensure database is in sync
      upsertDevice(device);
    }
  }
}

// Get all unique plugin IDs from device bindings
function getBoundPluginIds(): Set<string> {
  const pluginIds = new Set<string>();
  const devices = getAllDevices();

  for (const device of devices) {
    for (const button of device.config.buttons) {
      if (button.binding?.pluginId) {
        pluginIds.add(button.binding.pluginId);
      }
    }
  }

  return pluginIds;
}

// Main tick function - checks which plugins need polling
async function pollTick(): Promise<void> {
  const now = Date.now();
  const boundPlugins = getBoundPluginIds();

  for (const pluginId of boundPlugins) {
    if (shouldPollPlugin(pluginId, now)) {
      try {
        await pollPluginDevices(pluginId);
        lastPollTime.set(pluginId, now);
      } catch (error) {
        console.error(`[StateSync] Error polling plugin ${pluginId}:`, error);
      }
    }
  }
}

// Initial sync - poll all plugins and push states to all devices immediately
async function initialSync(): Promise<void> {
  console.log('[StateSync] Performing initial sync...');

  const devices = getAllDevices();
  const boundPlugins = getBoundPluginIds();
  const now = Date.now();

  // First, poll all plugins to get current external states
  for (const pluginId of boundPlugins) {
    console.log(`[StateSync] Initial poll for plugin: ${pluginId}`);
    try {
      const devicesToUpdate = getAllDevices();

      for (const device of devicesToUpdate) {
        if (!device.online) continue;

        for (const button of device.config.buttons) {
          if (!button.binding || button.binding.pluginId !== pluginId) continue;

          const externalState = await pluginManager.getDeviceState(button.binding);
          if (externalState) {
            // Update local state to match external
            if (button.state !== externalState.state) {
              console.log(`[StateSync] Initial sync: "${button.name}" ${button.state} -> ${externalState.state}`);
              button.state = externalState.state;
            }
            if (externalState.speedLevel !== undefined && button.speedLevel !== externalState.speedLevel) {
              button.speedLevel = externalState.speedLevel;
            }
          }
        }

        // Save any state updates
        upsertDevice(device);
      }

      lastPollTime.set(pluginId, now);
    } catch (error) {
      console.error(`[StateSync] Error during initial poll of ${pluginId}:`, error);
    }
  }

  // Then push all states to all online devices
  for (const device of devices) {
    if (!device.online) {
      console.log(`[StateSync] Skipping offline device for initial push: ${device.name}`);
      continue;
    }

    await pushAllStatesToDevice(device);
  }

  console.log('[StateSync] Initial sync complete');
}

// Start periodic state polling
export function startStatePolling(): void {
  if (tickInterval) return;

  // Log polling intervals for each registered plugin
  const plugins = pluginManager.getAllPlugins();
  for (const plugin of plugins) {
    const interval = plugin.pollingInterval || DEFAULT_POLL_INTERVAL;
    console.log(`[StateSync] Plugin "${plugin.name}" polling interval: ${interval / 1000}s`);
  }
  console.log(`[StateSync] Force push interval: ${FORCE_PUSH_INTERVAL / 1000}s`);

  console.log(`[StateSync] Starting state polling (tick interval: ${TICK_INTERVAL / 1000}s)`);

  // Perform initial sync
  initialSync().catch(error => {
    console.error('[StateSync] Initial sync error:', error);
  });

  // Start the tick interval
  tickInterval = setInterval(() => {
    pollTick().catch(error => {
      console.error('[StateSync] Tick error:', error);
    });
  }, TICK_INTERVAL);
}

// Sync a specific device: poll external states and push to panel
export async function syncDevice(device: Device): Promise<{ success: boolean; updatedButtons: number }> {
  console.log(`[StateSync] Manual sync requested for ${device.name}`);

  const buttonUpdates: Array<{ id: number; state: boolean; speedLevel?: number }> = [];

  // Poll all bound buttons from their plugins
  for (const button of device.config.buttons) {
    if (!button.binding) continue;

    const externalState = await pluginManager.getDeviceState(button.binding);
    if (externalState) {
      // Update local state to match external
      const changed = button.state !== externalState.state ||
                     (externalState.speedLevel !== undefined && button.speedLevel !== externalState.speedLevel);

      if (changed) {
        console.log(`[StateSync] Sync update: "${button.name}" ${button.state} -> ${externalState.state}`);
      }

      button.state = externalState.state;
      if (externalState.speedLevel !== undefined) {
        button.speedLevel = externalState.speedLevel;
      }
    }

    // Include all buttons in the update (not just changed ones)
    // Only include speedLevel for fan-type buttons
    const update: { id: number; state: boolean; speedLevel?: number } = {
      id: button.id,
      state: button.state
    };
    if (button.type === 'fan') {
      update.speedLevel = button.speedLevel;
    }
    buttonUpdates.push(update);
  }

  // Save updated states to database
  upsertDevice(device);

  // Push all button states to the panel
  if (device.online && device.ip) {
    const pushed = await pushButtonStatesToDevice(device, buttonUpdates);
    if (pushed) {
      lastPushTime.set(device.id, Date.now());
      console.log(`[StateSync] Manual sync complete: pushed ${buttonUpdates.length} button(s) to ${device.name}`);
      return { success: true, updatedButtons: buttonUpdates.length };
    } else {
      console.log(`[StateSync] Manual sync: failed to push to ${device.name}`);
      return { success: false, updatedButtons: 0 };
    }
  } else {
    console.log(`[StateSync] Manual sync: device ${device.name} is offline, states updated in DB only`);
    return { success: true, updatedButtons: buttonUpdates.length };
  }
}

// Stop state polling
export function stopStatePolling(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    lastPollTime.clear();
    lastPushTime.clear();
    console.log('[StateSync] Stopped state polling');
  }
}

// Force immediate poll for a specific plugin (useful after config changes)
export async function forcePluginPoll(pluginId: string): Promise<void> {
  console.log(`[StateSync] Force polling plugin: ${pluginId}`);
  await pollPluginDevices(pluginId);
  lastPollTime.set(pluginId, Date.now());
}

// Force push states to a specific device (useful after config changes)
export async function forceDevicePush(deviceId: string): Promise<void> {
  const devices = getAllDevices();
  const device = devices.find(d => d.id === deviceId);
  if (device && device.online) {
    await pushAllStatesToDevice(device);
  }
}

// Push state update for a specific external device to all panels that have buttons bound to it
export async function pushExternalDeviceState(
  pluginId: string,
  externalDeviceId: string,
  newState: boolean,
  speedLevel?: number
): Promise<void> {
  const devices = getAllDevices();

  for (const device of devices) {
    if (!device.online) continue;

    const buttonUpdates: Array<{ id: number; state: boolean; speedLevel?: number }> = [];

    for (const button of device.config.buttons) {
      if (!button.binding) continue;
      if (button.binding.pluginId !== pluginId) continue;
      if (button.binding.externalDeviceId !== externalDeviceId) continue;

      // Update local state
      button.state = newState;
      if (speedLevel !== undefined) {
        button.speedLevel = speedLevel;
      }

      const update: { id: number; state: boolean; speedLevel?: number } = {
        id: button.id,
        state: newState
      };
      if (button.type === 'fan' && speedLevel !== undefined) {
        update.speedLevel = speedLevel;
      }
      buttonUpdates.push(update);
    }

    if (buttonUpdates.length > 0) {
      console.log(`[StateSync] Pushing ${buttonUpdates.length} button state(s) to ${device.name} for external device ${externalDeviceId}`);
      await pushButtonStatesToDevice(device, buttonUpdates);
    }
  }
}
