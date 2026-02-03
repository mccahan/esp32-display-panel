import { Device } from '../db';
export declare function startStatePolling(): void;
export declare function syncDevice(device: Device): Promise<{
    success: boolean;
    updatedButtons: number;
}>;
export declare function stopStatePolling(): void;
export declare function forcePluginPoll(pluginId: string): Promise<void>;
export declare function forceDevicePush(deviceId: string): Promise<void>;
//# sourceMappingURL=stateSyncService.d.ts.map