// Plugin configuration stored in plugins.json
export interface PluginConfig {
  id: string;           // Unique plugin identifier
  name: string;         // Display name
  enabled: boolean;
  settings: Record<string, any>;  // Plugin-specific settings
}

// Device discovered from an external source (e.g., Homebridge)
export interface ImportableDevice {
  id: string;           // External device ID (e.g., Homebridge uniqueId)
  name: string;         // Display name
  type: 'light' | 'switch' | 'fan' | 'outlet';
  room?: string;
  capabilities: {
    on: boolean;
    brightness?: boolean;
    speed?: boolean;
  };
  metadata: Record<string, any>;  // Plugin-specific data
}

// Binding between a button and an external device
export interface ButtonBinding {
  pluginId: string;
  externalDeviceId: string;
  deviceType: string;
  metadata: Record<string, any>;
}

// Context passed to plugins when executing an action
export interface ActionContext {
  deviceId: string;     // ESP32 device ID
  buttonId: number;
  binding: ButtonBinding;
  newState: boolean;
  speedLevel?: number;
  timestamp: number;
}

// Result returned from plugin action execution
export interface ActionResult {
  success: boolean;
  newState?: boolean;
  error?: string;
}

// Device state returned from external system polling
export interface DeviceState {
  state: boolean;
  speedLevel?: number;  // 0-100 for fans
}

// HTTP request configuration for simple HTTP action plugins
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}

// Plugin interface that all plugins must implement
export interface Plugin {
  id: string;
  name: string;
  type: 'device-provider' | 'action-handler' | 'http-action';

  // Plugin description for UI
  description?: string;

  // Preferred state polling interval in milliseconds (default: 30000)
  // Set to 0 or undefined to use the default interval
  pollingInterval?: number;

  // Lifecycle methods
  initialize(config: PluginConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Device Provider methods (optional - for plugins that discover devices)
  discoverDevices?(): Promise<ImportableDevice[]>;

  // Action Handler methods (optional - for plugins that execute actions)
  executeAction?(ctx: ActionContext): Promise<ActionResult>;

  // HTTP Action methods (optional - for simple request plugins)
  getHttpConfig?(binding: ButtonBinding, action: 'on' | 'off' | 'toggle'): HttpRequest | null;

  // Connection test method (optional)
  testConnection?(): Promise<{ success: boolean; message: string }>;

  // Fetch current state of an external device (optional - for state polling)
  getDeviceState?(externalDeviceId: string): Promise<DeviceState | null>;
}

// Plugin storage format in plugins.json
export interface PluginStorage {
  configs: Record<string, PluginConfig>;
}
