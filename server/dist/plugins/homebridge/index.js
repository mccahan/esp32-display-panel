"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class HomebridgePlugin {
    constructor() {
        this.id = 'homebridge';
        this.name = 'Homebridge';
        this.type = 'device-provider';
        this.description = 'Import and control devices from Homebridge';
        this.pollingInterval = 15000; // Poll Homebridge devices every 15 seconds
        this.token = null;
        this.tokenExpiry = 0;
        this.config = null;
    }
    async initialize(config) {
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
    async shutdown() {
        this.token = null;
        this.tokenExpiry = 0;
        this.config = null;
    }
    // Get base URL from config
    getBaseUrl() {
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
    async getToken() {
        // Return cached token if still valid (with 5 minute buffer)
        if (this.token && Date.now() < this.tokenExpiry - 300000) {
            return this.token;
        }
        const baseUrl = this.getBaseUrl();
        const { username, password } = this.config.settings;
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
        const data = await response.json();
        this.token = data.access_token;
        // expires_in is in seconds, convert to milliseconds
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);
        console.log('Homebridge: Authenticated successfully');
        return this.token;
    }
    // Fetch room layout
    async getRoomLayout() {
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
            const layout = await response.json();
            const roomMap = new Map();
            for (const room of layout.rooms || []) {
                for (const service of room.services || []) {
                    roomMap.set(service.uniqueId, room.name);
                }
            }
            return roomMap;
        }
        catch (error) {
            console.log('Homebridge: Could not fetch room layout');
            return new Map();
        }
    }
    // Map Homebridge type to our device type
    mapDeviceType(humanType) {
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
    getCapabilities(characteristics) {
        const caps = {
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
    async discoverDevices() {
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
        const accessories = await response.json();
        const roomMap = await this.getRoomLayout();
        const devices = [];
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
    async executeAction(ctx) {
        const baseUrl = this.getBaseUrl();
        const token = await this.getToken();
        const { externalDeviceId, metadata } = ctx.binding;
        try {
            // Build characteristic update based on action
            let characteristicType = 'On';
            let value = ctx.newState ? 1 : 0;
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
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to execute action: ${error.message}`
            };
        }
    }
    // Test connection to Homebridge
    async testConnection() {
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
                const accessories = await response.json();
                return {
                    success: true,
                    message: `Connected to Homebridge. Found ${accessories.length} accessories.`
                };
            }
            else {
                return {
                    success: false,
                    message: `API error: ${response.status} ${response.statusText}`
                };
            }
        }
        catch (error) {
            return {
                success: false,
                message: `Connection failed: ${error.message}`
            };
        }
    }
    // Fetch current state of a device from Homebridge
    async getDeviceState(externalDeviceId) {
        try {
            const baseUrl = this.getBaseUrl();
            const token = await this.getToken();
            const response = await fetch(`${baseUrl}/api/accessories/${externalDeviceId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                console.log(`Homebridge: Failed to get state for ${externalDeviceId}: ${response.status}`);
                return null;
            }
            const accessory = await response.json();
            // Extract On characteristic value
            const onChar = accessory.serviceCharacteristics?.find(c => c.type === 'On');
            const speedChar = accessory.serviceCharacteristics?.find(c => c.type === 'RotationSpeed');
            // Log raw value for debugging
            console.log(`Homebridge: Device ${accessory.serviceName || externalDeviceId.substring(0, 12)} On.value=${onChar?.value} (type: ${typeof onChar?.value})`);
            // Handle various value formats from Homebridge
            let state = false;
            if (onChar?.value !== undefined) {
                state = onChar.value === 1 || onChar.value === true || onChar.value === '1' || onChar.value === 'true';
            }
            const speedLevel = speedChar?.value;
            return {
                state,
                speedLevel
            };
        }
        catch (error) {
            console.error(`Homebridge: Error fetching state for ${externalDeviceId}:`, error.message);
            return null;
        }
    }
}
exports.default = new HomebridgePlugin();
//# sourceMappingURL=index.js.map