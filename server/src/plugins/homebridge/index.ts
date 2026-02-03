import {
  Plugin,
  PluginConfig,
  ImportableDevice,
  ActionContext,
  ActionResult
} from '../types';

// Homebridge accessory from API
interface HomebridgeAccessory {
  aid: number;
  iid: number;
  uuid: string;
  type: string;
  humanType: string;
  serviceName: string;
  serviceCharacteristics: HomebridgeCharacteristic[];
  accessoryInformation: {
    Manufacturer?: string;
    Model?: string;
    Name?: string;
    'Serial Number'?: string;
    'Firmware Revision'?: string;
  };
  values: Record<string, any>;
  instance: {
    name: string;
    username: string;
    ipAddress?: string;
    port?: number;
  };
  uniqueId: string;
}

interface HomebridgeCharacteristic {
  aid: number;
  iid: number;
  uuid: string;
  type: string;
  serviceType: string;
  serviceName: string;
  description: string;
  value: any;
  format: string;
  perms: string[];
  canRead: boolean;
  canWrite: boolean;
  ev: boolean;
  minValue?: number;
  maxValue?: number;
  minStep?: number;
}

// Homebridge room layout
interface HomebridgeRoom {
  name: string;
  services: Array<{
    uniqueId: string;
    aid: number;
    iid: number;
    uuid: string;
  }>;
}

interface HomebridgeLayout {
  rooms: HomebridgeRoom[];
}

class HomebridgePlugin implements Plugin {
  id = 'homebridge';
  name = 'Homebridge';
  type: 'device-provider' = 'device-provider';
  description = 'Import and control devices from Homebridge';

  private token: string | null = null;
  private tokenExpiry: number = 0;
  private config: PluginConfig | null = null;

  async initialize(config: PluginConfig): Promise<void> {
    this.config = config;

    // Validate required settings
    const { serverUrl, username, password } = config.settings;
    if (!serverUrl) {
      throw new Error('Homebridge server URL is required');
    }
    if (!username || !password) {
      throw new Error('Homebridge username and password are required');
    }

    // Clear cached token on re-initialization
    this.token = null;
    this.tokenExpiry = 0;
  }

  async shutdown(): Promise<void> {
    this.token = null;
    this.tokenExpiry = 0;
    this.config = null;
  }

  // Get base URL from config
  private getBaseUrl(): string {
    if (!this.config?.settings.serverUrl) {
      throw new Error('Homebridge server URL not configured');
    }
    let url = this.config.settings.serverUrl;
    // Remove trailing slash
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    return url;
  }

  // Authenticate and get token
  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    if (this.token && Date.now() < this.tokenExpiry - 300000) {
      return this.token;
    }

    const baseUrl = this.getBaseUrl();
    const { username, password } = this.config!.settings;

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Authentication failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.token = data.access_token;
    // expires_in is in seconds, convert to milliseconds
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    console.log('Homebridge: Authenticated successfully');
    return this.token!;
  }

  // Fetch room layout
  private async getRoomLayout(): Promise<Map<string, string>> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getToken();

    try {
      const response = await fetch(`${baseUrl}/api/accessories/layout`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.log('Homebridge: Room layout not available');
        return new Map();
      }

      const layout = await response.json() as HomebridgeLayout;
      const roomMap = new Map<string, string>();

      for (const room of layout.rooms || []) {
        for (const service of room.services || []) {
          roomMap.set(service.uniqueId, room.name);
        }
      }

      return roomMap;
    } catch (error) {
      console.log('Homebridge: Could not fetch room layout');
      return new Map();
    }
  }

  // Map Homebridge type to our device type
  private mapDeviceType(humanType: string): 'light' | 'switch' | 'fan' | 'outlet' | null {
    const type = humanType.toLowerCase();
    if (type.includes('lightbulb') || type.includes('light')) {
      return 'light';
    }
    if (type.includes('switch')) {
      return 'switch';
    }
    if (type.includes('fan')) {
      return 'fan';
    }
    if (type.includes('outlet')) {
      return 'outlet';
    }
    return null;
  }

  // Check device capabilities from characteristics
  private getCapabilities(characteristics: HomebridgeCharacteristic[]): ImportableDevice['capabilities'] {
    const caps: ImportableDevice['capabilities'] = {
      on: false,
      brightness: false,
      speed: false
    };

    for (const char of characteristics) {
      if (char.type === 'On' && char.canWrite) {
        caps.on = true;
      }
      if (char.type === 'Brightness' && char.canWrite) {
        caps.brightness = true;
      }
      if (char.type === 'RotationSpeed' && char.canWrite) {
        caps.speed = true;
      }
    }

    return caps;
  }

  // Discover devices from Homebridge
  async discoverDevices(): Promise<ImportableDevice[]> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getToken();

    const response = await fetch(`${baseUrl}/api/accessories`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch accessories: ${response.status}`);
    }

    const accessories = await response.json() as HomebridgeAccessory[];
    const roomMap = await this.getRoomLayout();

    const devices: ImportableDevice[] = [];

    for (const accessory of accessories) {
      const deviceType = this.mapDeviceType(accessory.humanType);
      if (!deviceType) {
        continue; // Skip unsupported device types
      }

      const capabilities = this.getCapabilities(accessory.serviceCharacteristics);
      if (!capabilities.on) {
        continue; // Skip devices that can't be controlled
      }

      devices.push({
        id: accessory.uniqueId,
        name: accessory.serviceName || accessory.accessoryInformation.Name || 'Unknown Device',
        type: deviceType,
        room: roomMap.get(accessory.uniqueId),
        capabilities,
        metadata: {
          aid: accessory.aid,
          iid: accessory.iid,
          uuid: accessory.uuid,
          humanType: accessory.humanType,
          manufacturer: accessory.accessoryInformation.Manufacturer,
          model: accessory.accessoryInformation.Model
        }
      });
    }

    console.log(`Homebridge: Discovered ${devices.length} controllable devices`);
    return devices;
  }

  // Execute action on Homebridge device
  async executeAction(ctx: ActionContext): Promise<ActionResult> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getToken();
    const { externalDeviceId, metadata } = ctx.binding;

    try {
      // Build characteristic update based on action
      let characteristicType = 'On';
      let value: number = ctx.newState ? 1 : 0;

      // Handle fan speed if specified
      if (ctx.speedLevel !== undefined && ctx.binding.deviceType === 'fan') {
        characteristicType = 'RotationSpeed';
        value = ctx.speedLevel;
      }

      const response = await fetch(`${baseUrl}/api/accessories/${externalDeviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          characteristicType,
          value
        })
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Homebridge API error: ${response.status} ${text}`
        };
      }

      console.log(`Homebridge: Set ${externalDeviceId} ${characteristicType}=${value}`);

      return {
        success: true,
        newState: ctx.newState
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to execute action: ${error.message}`
      };
    }
  }

  // Test connection to Homebridge
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const token = await this.getToken();
      const baseUrl = this.getBaseUrl();

      // Try to fetch accessories as a connection test
      const response = await fetch(`${baseUrl}/api/accessories`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const accessories = await response.json() as HomebridgeAccessory[];
        return {
          success: true,
          message: `Connected to Homebridge. Found ${accessories.length} accessories.`
        };
      } else {
        return {
          success: false,
          message: `API error: ${response.status} ${response.statusText}`
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Connection failed: ${error.message}`
      };
    }
  }
}

export default new HomebridgePlugin();
