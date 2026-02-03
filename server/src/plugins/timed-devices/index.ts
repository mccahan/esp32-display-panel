import {
  Plugin,
  PluginConfig,
  ImportableDevice,
  ActionContext,
  ActionResult,
  DeviceState
} from '../types';
import { scheduler, ScheduledJob, ActionExecutor } from './scheduler';
import { pluginManager } from '../pluginManager';

// Timed device configuration stored in plugin settings
export interface TimedDeviceConfig {
  id: string;
  name: string;
  icon: string;
  actionType: 'on_for' | 'on_after' | 'off_after';
  durationMinutes: number;
  targetDevices: Array<{
    pluginId: string;
    externalDeviceId: string;
    deviceName: string;
    deviceType: string;
  }>;
  createdAt: number;
}

// Plugin settings structure
interface TimedDevicesSettings {
  timedDevices: TimedDeviceConfig[];
}

class TimedDevicesPlugin implements Plugin {
  id = 'timed-devices';
  name = 'Timed Devices';
  type: 'device-provider' = 'device-provider';
  description = 'Create buttons with timed actions (turn on for X minutes, turn off after X minutes)';
  pollingInterval = 5000;  // Check frequently for job status updates

  private config: PluginConfig | null = null;

  async initialize(config: PluginConfig): Promise<void> {
    this.config = config;

    // Ensure settings structure exists
    if (!this.config.settings.timedDevices) {
      this.config.settings.timedDevices = [];
    }

    // Set up action executor for the scheduler
    const executor: ActionExecutor = async (pluginId, externalDeviceId, newState) => {
      // Create a minimal action context for the target plugin
      const ctx: ActionContext = {
        deviceId: 'timed-devices-internal',
        buttonId: 0,
        binding: {
          pluginId,
          externalDeviceId,
          deviceType: 'switch',
          metadata: {}
        },
        newState,
        timestamp: Date.now()
      };

      try {
        const result = await pluginManager.executeAction(ctx);
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    };

    scheduler.setActionExecutor(executor);
    console.log(`[TimedDevices] Initialized with ${this.getTimedDevices().length} timed device(s)`);
  }

  async shutdown(): Promise<void> {
    scheduler.shutdown();
    this.config = null;
    console.log('[TimedDevices] Plugin shutdown');
  }

  private getSettings(): TimedDevicesSettings {
    if (!this.config) {
      return { timedDevices: [] };
    }
    return this.config.settings as TimedDevicesSettings;
  }

  private getTimedDevices(): TimedDeviceConfig[] {
    return this.getSettings().timedDevices || [];
  }

  // Discover devices - returns our timed devices as scene-like buttons
  async discoverDevices(): Promise<ImportableDevice[]> {
    const timedDevices = this.getTimedDevices();

    return timedDevices.map(td => ({
      id: td.id,
      name: td.name,
      type: 'switch' as const,  // Timed devices appear as switches/scenes
      room: 'Timed Actions',
      capabilities: {
        on: true,
        brightness: false,
        speed: false
      },
      metadata: {
        icon: td.icon,
        actionType: td.actionType,
        durationMinutes: td.durationMinutes,
        targetDeviceCount: td.targetDevices.length,
        isTimedDevice: true
      }
    }));
  }

  // Execute action - trigger the timed device
  async executeAction(ctx: ActionContext): Promise<ActionResult> {
    const timedDeviceId = ctx.binding.externalDeviceId;
    const timedDevice = this.getTimedDevices().find(td => td.id === timedDeviceId);

    if (!timedDevice) {
      return { success: false, error: `Timed device ${timedDeviceId} not found` };
    }

    // Only trigger on "turn on" action (button press)
    if (!ctx.newState) {
      // Cancel any pending jobs when "turned off"
      const cancelled = scheduler.cancelJobsForTimedDevice(timedDeviceId);
      if (cancelled > 0) {
        console.log(`[TimedDevices] Cancelled ${cancelled} pending job(s) for ${timedDevice.name}`);
      }
      return { success: true, newState: false };
    }

    const durationMs = timedDevice.durationMinutes * 60 * 1000;
    const targetDevices = timedDevice.targetDevices.map(d => ({
      pluginId: d.pluginId,
      externalDeviceId: d.externalDeviceId,
      deviceName: d.deviceName
    }));

    switch (timedDevice.actionType) {
      case 'on_for': {
        // Turn on immediately, schedule turn off
        console.log(`[TimedDevices] "${timedDevice.name}": Turning on ${targetDevices.length} device(s), will turn off in ${timedDevice.durationMinutes}m`);

        // Turn on all devices immediately
        for (const device of targetDevices) {
          const turnOnCtx: ActionContext = {
            deviceId: ctx.deviceId,
            buttonId: ctx.buttonId,
            binding: {
              pluginId: device.pluginId,
              externalDeviceId: device.externalDeviceId,
              deviceType: 'switch',
              metadata: {}
            },
            newState: true,
            timestamp: Date.now()
          };
          await pluginManager.executeAction(turnOnCtx);
        }

        // Schedule turn off
        scheduler.scheduleJob(
          timedDeviceId,
          timedDevice.name,
          'turn_off',
          durationMs,
          targetDevices
        );
        break;
      }

      case 'on_after': {
        // Schedule turn on
        console.log(`[TimedDevices] "${timedDevice.name}": Will turn on ${targetDevices.length} device(s) in ${timedDevice.durationMinutes}m`);
        scheduler.scheduleJob(
          timedDeviceId,
          timedDevice.name,
          'turn_on',
          durationMs,
          targetDevices
        );
        break;
      }

      case 'off_after': {
        // Schedule turn off
        console.log(`[TimedDevices] "${timedDevice.name}": Will turn off ${targetDevices.length} device(s) in ${timedDevice.durationMinutes}m`);
        scheduler.scheduleJob(
          timedDeviceId,
          timedDevice.name,
          'turn_off',
          durationMs,
          targetDevices
        );
        break;
      }
    }

    // Return true to indicate the "scene" was triggered
    // The button will show as "on" briefly then turn off
    return { success: true, newState: true };
  }

  // Get device state - returns true only if there's an active job, false otherwise
  async getDeviceState(externalDeviceId: string): Promise<DeviceState | null> {
    const timedDevice = this.getTimedDevices().find(td => td.id === externalDeviceId);

    // For timed devices (scene-like buttons), always return a state
    // If the timed device was deleted or doesn't exist, return false
    if (!timedDevice) {
      return { state: false, speedLevel: undefined };
    }

    // Check if there are any active jobs for this timed device
    const activeJobs = scheduler.getJobsForTimedDevice(externalDeviceId)
      .filter(j => j.status === 'pending' || j.status === 'executing');

    // Return true if there's an active job (shows visual feedback)
    return {
      state: activeJobs.length > 0,
      speedLevel: undefined
    };
  }

  // Test connection - always succeeds since this is a local plugin
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const timedDevices = this.getTimedDevices();
    const activeJobs = scheduler.getActiveJobs();
    return {
      success: true,
      message: `${timedDevices.length} timed device(s) configured, ${activeJobs.length} active job(s)`
    };
  }

  // =============================================
  // Custom methods for managing timed devices
  // =============================================

  // Get all timed device configurations
  getTimedDeviceConfigs(): TimedDeviceConfig[] {
    return this.getTimedDevices();
  }

  // Get a specific timed device
  getTimedDeviceConfig(id: string): TimedDeviceConfig | undefined {
    return this.getTimedDevices().find(td => td.id === id);
  }

  // Create a new timed device
  async createTimedDevice(config: Omit<TimedDeviceConfig, 'id' | 'createdAt'>): Promise<TimedDeviceConfig> {
    if (!this.config) {
      throw new Error('Plugin not initialized');
    }

    const id = `timed_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newDevice: TimedDeviceConfig = {
      ...config,
      id,
      createdAt: Date.now()
    };

    const settings = this.getSettings();
    settings.timedDevices.push(newDevice);

    // Save via plugin manager (handles persistence)
    await pluginManager.setPluginConfig(this.id, {
      settings
    });

    console.log(`[TimedDevices] Created timed device: ${newDevice.name} (${newDevice.actionType}, ${newDevice.durationMinutes}m, ${newDevice.targetDevices.length} target(s))`);
    return newDevice;
  }

  // Update a timed device
  async updateTimedDevice(id: string, updates: Partial<Omit<TimedDeviceConfig, 'id' | 'createdAt'>>): Promise<TimedDeviceConfig | null> {
    if (!this.config) {
      throw new Error('Plugin not initialized');
    }

    const settings = this.getSettings();
    const index = settings.timedDevices.findIndex(td => td.id === id);

    if (index === -1) {
      return null;
    }

    const updated: TimedDeviceConfig = {
      ...settings.timedDevices[index],
      ...updates
    };
    settings.timedDevices[index] = updated;

    await pluginManager.setPluginConfig(this.id, {
      settings
    });

    console.log(`[TimedDevices] Updated timed device: ${updated.name}`);
    return updated;
  }

  // Delete a timed device
  async deleteTimedDevice(id: string): Promise<boolean> {
    if (!this.config) {
      throw new Error('Plugin not initialized');
    }

    const settings = this.getSettings();
    const index = settings.timedDevices.findIndex(td => td.id === id);

    if (index === -1) {
      return false;
    }

    const deleted = settings.timedDevices.splice(index, 1)[0];

    // Cancel any pending jobs
    scheduler.cancelJobsForTimedDevice(id);

    await pluginManager.setPluginConfig(this.id, {
      settings
    });

    console.log(`[TimedDevices] Deleted timed device: ${deleted.name}`);
    return true;
  }

  // Get all scheduled jobs
  getScheduledJobs(): ScheduledJob[] {
    return scheduler.getAllJobs();
  }

  // Get active jobs only
  getActiveJobs(): ScheduledJob[] {
    return scheduler.getActiveJobs();
  }

  // Cancel a specific job
  cancelJob(jobId: string): boolean {
    return scheduler.cancelJob(jobId);
  }

  // Discover devices from other plugins for selection
  async discoverSourceDevices(): Promise<Array<ImportableDevice & { pluginId: string; pluginName: string }>> {
    const allDevices: Array<ImportableDevice & { pluginId: string; pluginName: string }> = [];

    for (const plugin of pluginManager.getAllPlugins()) {
      // Skip ourselves and disabled plugins
      if (plugin.id === this.id) continue;

      const config = pluginManager.getPluginConfig(plugin.id);
      if (!config?.enabled) continue;

      // Only include plugins that can discover devices
      if (!plugin.discoverDevices) continue;

      try {
        const devices = await plugin.discoverDevices();
        for (const device of devices) {
          allDevices.push({
            ...device,
            pluginId: plugin.id,
            pluginName: plugin.name
          });
        }
      } catch (err: any) {
        console.log(`[TimedDevices] Failed to discover devices from ${plugin.name}: ${err.message}`);
      }
    }

    return allDevices;
  }
}

// Export singleton instance
const timedDevicesPlugin = new TimedDevicesPlugin();
export default timedDevicesPlugin;

// Export type for use in routes
export type { TimedDevicesPlugin };
