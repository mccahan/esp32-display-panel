import { Plugin, PluginConfig, ImportableDevice, ActionContext, ActionResult, DeviceState } from '../types';
declare class HomebridgePlugin implements Plugin {
    id: string;
    name: string;
    type: 'device-provider';
    description: string;
    pollingInterval: number;
    private token;
    private tokenExpiry;
    private config;
    initialize(config: PluginConfig): Promise<void>;
    shutdown(): Promise<void>;
    private getBaseUrl;
    private getToken;
    private getRoomLayout;
    private mapDeviceType;
    private getCapabilities;
    discoverDevices(): Promise<ImportableDevice[]>;
    executeAction(ctx: ActionContext): Promise<ActionResult>;
    testConnection(): Promise<{
        success: boolean;
        message: string;
    }>;
    getDeviceState(externalDeviceId: string): Promise<DeviceState | null>;
}
declare const _default: HomebridgePlugin;
export default _default;
//# sourceMappingURL=index.d.ts.map