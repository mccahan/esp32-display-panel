import { Device, DeviceConfig, DiscoveredDevice } from '../db';
export declare function pushConfigToDevice(device: Device): Promise<boolean>;
export declare function fetchDeviceState(device: Device): Promise<any | null>;
export declare function pingDevice(device: Device): Promise<boolean>;
export declare function captureDeviceScreenshot(device: Device): Promise<boolean>;
export declare function getDeviceScreenshot(device: Device): Promise<Buffer | null>;
export declare function adoptDevice(discovered: DiscoveredDevice, name: string, location: string, serverIp: string): Device;
export declare function updateDeviceConfig(deviceId: string, updates: Partial<DeviceConfig>): Device | null;
export declare function checkAllDevicesHealth(): Promise<void>;
export declare function startHealthChecks(intervalMs?: number): void;
export declare function stopHealthChecks(): void;
export declare function pushButtonStatesToDevice(device: Device, buttonUpdates: Array<{
    id: number;
    state: boolean;
    speedLevel?: number;
}>): Promise<boolean>;
//# sourceMappingURL=deviceService.d.ts.map