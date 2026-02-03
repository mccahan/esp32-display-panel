import { getAllDevices, upsertDevice, Device } from '../db';
import { pluginManager } from '../plugins/pluginManager';
import { pushButtonStatesToDevice } from './deviceService';

let pollInterval: NodeJS.Timeout | null = null;

// Poll all bound devices for external state changes
export async function pollAllBoundDevices(): Promise<void> {
  const devices = getAllDevices();

  for (const device of devices) {
    if (!device.online) continue;

    const buttonUpdates: Array<{ id: number; state: boolean; speedLevel?: number }> = [];
    let hasChanges = false;

    for (const button of device.config.buttons) {
      if (!button.binding) continue;

      const externalState = await pluginManager.getDeviceState(button.binding);
      if (!externalState) continue;

      // Check if state changed
      const stateChanged = button.state !== externalState.state;
      const speedChanged = externalState.speedLevel !== undefined &&
                          button.speedLevel !== externalState.speedLevel;

      if (stateChanged || speedChanged) {
        // Update local state
        button.state = externalState.state;
        if (externalState.speedLevel !== undefined) {
          button.speedLevel = externalState.speedLevel;
        }

        buttonUpdates.push({
          id: button.id,
          state: externalState.state,
          speedLevel: externalState.speedLevel
        });
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Push to ESP32 device
      const pushed = await pushButtonStatesToDevice(device, buttonUpdates);
      if (pushed) {
        // Save to database
        upsertDevice(device);
        console.log(`[StateSync] Pushed ${buttonUpdates.length} update(s) to ${device.name}`);
      }
    }
  }
}

// Start periodic state polling
export function startStatePolling(intervalMs: number = 30000): void {
  if (pollInterval) return;

  console.log(`Starting state polling every ${intervalMs / 1000} seconds`);
  pollInterval = setInterval(() => {
    pollAllBoundDevices().catch(error => {
      console.error('[StateSync] Polling error:', error);
    });
  }, intervalMs);

  // Run immediately on start
  pollAllBoundDevices().catch(error => {
    console.error('[StateSync] Initial polling error:', error);
  });
}

// Stop state polling
export function stopStatePolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('Stopped state polling');
  }
}
