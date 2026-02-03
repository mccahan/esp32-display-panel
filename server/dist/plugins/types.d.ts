export interface PluginConfig {
    id: string;
    name: string;
    enabled: boolean;
    settings: Record<string, any>;
}
export interface ImportableDevice {
    id: string;
    name: string;
    type: 'light' | 'switch' | 'fan' | 'outlet';
    room?: string;
    capabilities: {
        on: boolean;
        brightness?: boolean;
        speed?: boolean;
    };
    metadata: Record<string, any>;
}
export interface ButtonBinding {
    pluginId: string;
    externalDeviceId: string;
    deviceType: string;
    metadata: Record<string, any>;
}
export interface ActionContext {
    deviceId: string;
    buttonId: number;
    binding: ButtonBinding;
    newState: boolean;
    speedLevel?: number;
    timestamp: number;
}
export interface ActionResult {
    success: boolean;
    newState?: boolean;
    error?: string;
}
export interface HttpRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: any;
}
export interface Plugin {
    id: string;
    name: string;
    type: 'device-provider' | 'action-handler' | 'http-action';
    description?: string;
    initialize(config: PluginConfig): Promise<void>;
    shutdown(): Promise<void>;
    discoverDevices?(): Promise<ImportableDevice[]>;
    executeAction?(ctx: ActionContext): Promise<ActionResult>;
    getHttpConfig?(binding: ButtonBinding, action: 'on' | 'off' | 'toggle'): HttpRequest | null;
    testConnection?(): Promise<{
        success: boolean;
        message: string;
    }>;
}
export interface PluginStorage {
    configs: Record<string, PluginConfig>;
}
//# sourceMappingURL=types.d.ts.map