import * as fs from 'fs';
import * as path from 'path';
import {
  Plugin,
  PluginConfig,
  PluginStorage,
  ImportableDevice,
  ActionContext,
  ActionResult,
  ButtonBinding,
  DeviceState
} from './types';

// Data directory path
const DATA_DIR = path.join(__dirname, '../../data');
const PLUGINS_FILE = path.join(DATA_DIR, 'plugins.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private configs: Map<string, PluginConfig> = new Map();
  private initialized: boolean = false;

  // Load plugin configurations from file
  async loadConfigs(): Promise<void> {
    try {
      if (fs.existsSync(PLUGINS_FILE)) {
        const data = fs.readFileSync(PLUGINS_FILE, 'utf-8');
        const storage: PluginStorage = JSON.parse(data);
        this.configs = new Map(Object.entries(storage.configs || {}));
        console.log(`Loaded ${this.configs.size} plugin configurations`);
      }
    } catch (error) {
      console.error('Failed to load plugin configs:', error);
      this.configs = new Map();
    }
  }

  // Save plugin configurations to file
  async saveConfigs(): Promise<void> {
    try {
      const storage: PluginStorage = {
        configs: Object.fromEntries(this.configs)
      };
      fs.writeFileSync(PLUGINS_FILE, JSON.stringify(storage, null, 2));
    } catch (error) {
      console.error('Failed to save plugin configs:', error);
    }
  }

  // Register a plugin instance
  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
    console.log(`Registered plugin: ${plugin.name} (${plugin.id})`);

    // Create default config if none exists
    if (!this.configs.has(plugin.id)) {
      const defaultConfig: PluginConfig = {
        id: plugin.id,
        name: plugin.name,
        enabled: false,
        settings: {}
      };
      this.configs.set(plugin.id, defaultConfig);
    }
  }

  // Initialize all registered plugins
  async initializePlugins(): Promise<void> {
    if (this.initialized) return;

    await this.loadConfigs();

    for (const [id, plugin] of this.plugins) {
      const config = this.configs.get(id);
      if (config && config.enabled) {
        try {
          await plugin.initialize(config);
          console.log(`Initialized plugin: ${plugin.name}`);
        } catch (error) {
          console.error(`Failed to initialize plugin ${plugin.name}:`, error);
        }
      }
    }

    this.initialized = true;
  }

  // Shutdown all plugins
  async shutdown(): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      try {
        await plugin.shutdown();
        console.log(`Shutdown plugin: ${plugin.name}`);
      } catch (error) {
        console.error(`Failed to shutdown plugin ${plugin.name}:`, error);
      }
    }
    this.initialized = false;
  }

  // Get all registered plugins
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  // Get plugin by ID
  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  // Get all device provider plugins
  getDeviceProviders(): Plugin[] {
    return Array.from(this.plugins.values()).filter(
      p => p.type === 'device-provider' && p.discoverDevices
    );
  }

  // Discover devices from a specific plugin
  async discoverDevices(pluginId: string): Promise<ImportableDevice[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.discoverDevices) {
      throw new Error(`Plugin ${pluginId} does not support device discovery`);
    }

    const config = this.configs.get(pluginId);
    if (!config || !config.enabled) {
      throw new Error(`Plugin ${pluginId} is not enabled`);
    }

    return plugin.discoverDevices();
  }

  // Execute action through appropriate plugin
  async executeAction(ctx: ActionContext): Promise<ActionResult> {
    const plugin = this.plugins.get(ctx.binding.pluginId);
    if (!plugin) {
      return { success: false, error: `Plugin ${ctx.binding.pluginId} not found` };
    }

    const config = this.configs.get(ctx.binding.pluginId);
    if (!config || !config.enabled) {
      return { success: false, error: `Plugin ${ctx.binding.pluginId} is not enabled` };
    }

    // Try executeAction first (for full plugins)
    if (plugin.executeAction) {
      return plugin.executeAction(ctx);
    }

    // Fall back to HTTP action (for simple plugins)
    if (plugin.getHttpConfig) {
      const action = ctx.newState ? 'on' : 'off';
      const httpConfig = plugin.getHttpConfig(ctx.binding, action);
      if (httpConfig) {
        try {
          const response = await fetch(httpConfig.url, {
            method: httpConfig.method,
            headers: httpConfig.headers,
            body: httpConfig.body ? JSON.stringify(httpConfig.body) : undefined
          });

          if (response.ok) {
            return { success: true, newState: ctx.newState };
          } else {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
          }
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    }

    return { success: false, error: 'Plugin does not support action execution' };
  }

  // Get plugin configuration
  getPluginConfig(pluginId: string): PluginConfig | undefined {
    return this.configs.get(pluginId);
  }

  // Update plugin configuration
  async setPluginConfig(pluginId: string, config: Partial<PluginConfig>): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const existing = this.configs.get(pluginId) || {
      id: pluginId,
      name: plugin.name,
      enabled: false,
      settings: {}
    };

    const updated: PluginConfig = {
      ...existing,
      ...config,
      id: pluginId,  // Ensure ID can't be changed
      name: config.name || existing.name
    };

    this.configs.set(pluginId, updated);
    await this.saveConfigs();

    // Re-initialize plugin if enabled status changed
    if (config.enabled !== undefined && config.enabled !== existing.enabled) {
      if (config.enabled) {
        try {
          await plugin.initialize(updated);
          console.log(`Initialized plugin: ${plugin.name}`);
        } catch (error) {
          console.error(`Failed to initialize plugin ${plugin.name}:`, error);
          throw error;
        }
      } else {
        await plugin.shutdown();
        console.log(`Disabled plugin: ${plugin.name}`);
      }
    } else if (config.settings && existing.enabled) {
      // Re-initialize if settings changed while enabled
      await plugin.shutdown();
      await plugin.initialize(updated);
      console.log(`Reinitialized plugin: ${plugin.name} with new settings`);
    }
  }

  // Test plugin connection
  async testConnection(pluginId: string): Promise<{ success: boolean; message: string }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return { success: false, message: `Plugin ${pluginId} not found` };
    }

    if (!plugin.testConnection) {
      return { success: false, message: 'Plugin does not support connection testing' };
    }

    const config = this.configs.get(pluginId);
    if (!config) {
      return { success: false, message: 'Plugin not configured' };
    }

    // Temporarily initialize for testing if not enabled
    const wasEnabled = config.enabled;
    if (!wasEnabled) {
      try {
        await plugin.initialize(config);
      } catch (error: any) {
        return { success: false, message: `Initialization failed: ${error.message}` };
      }
    }

    try {
      const result = await plugin.testConnection();
      return result;
    } finally {
      if (!wasEnabled) {
        await plugin.shutdown();
      }
    }
  }

  // Get device state through plugin (for state polling)
  async getDeviceState(binding: ButtonBinding): Promise<DeviceState | null> {
    const plugin = this.plugins.get(binding.pluginId);
    if (!plugin?.getDeviceState) {
      return null;
    }

    const config = this.configs.get(binding.pluginId);
    if (!config?.enabled) {
      return null;
    }

    try {
      return await plugin.getDeviceState(binding.externalDeviceId);
    } catch (error: any) {
      console.error(`Error getting device state for ${binding.externalDeviceId}:`, error.message);
      return null;
    }
  }
}

// Singleton instance
export const pluginManager = new PluginManager();
