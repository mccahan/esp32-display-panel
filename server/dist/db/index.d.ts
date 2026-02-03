import { ButtonBinding } from '../plugins/types';
export { ButtonBinding } from '../plugins/types';
export interface LCARSTextField {
    id: string;
    value: string;
    style: 'title' | 'label' | 'data' | 'status';
}
export interface LCARSConfig {
    enabled: boolean;
    colorScheme: 'federation' | 'medical' | 'engineering' | 'tactical';
    headerLeft: string;
    headerRight: string;
    footerLeft: string;
    footerRight: string;
    sidebarTop: string;
    sidebarBottom: string;
    customFields: LCARSTextField[];
}
export interface DayNightConfig {
    enabled: boolean;
    dayTheme: string;
    nightTheme: string;
    dayStartHour: number;
    nightStartHour: number;
}
export interface ButtonConfig {
    id: number;
    type: 'light' | 'switch' | 'fan';
    name: string;
    icon: string;
    state: boolean;
    subtitle?: string;
    speedSteps?: number;
    speedLevel?: number;
    binding?: ButtonBinding;
}
export interface SceneConfig {
    id: number;
    name: string;
    icon: string;
}
export interface DisplayConfig {
    brightness: number;
    theme: 'light_mode' | 'neon_cyberpunk' | 'dark_clean' | 'lcars';
    dayNightMode: DayNightConfig;
    lcars: LCARSConfig;
}
export interface ServerConfig {
    host: string;
    port: number;
}
export interface DeviceInfo {
    id: string;
    name: string;
    location: string;
}
export interface DeviceConfig {
    version: number;
    device: DeviceInfo;
    display: DisplayConfig;
    buttons: ButtonConfig[];
    scenes: SceneConfig[];
    server: ServerConfig;
}
export interface Device {
    id: string;
    mac: string;
    ip: string;
    name: string;
    location: string;
    config: DeviceConfig;
    lastSeen: number;
    online: boolean;
    adopted: boolean;
}
export interface DiscoveredDevice {
    id: string;
    name: string;
    mac: string;
    ip: string;
    port: number;
    discoveredAt: number;
}
export declare function loadDevices(): void;
export declare function saveDevices(): void;
export declare function getAllDevices(): Device[];
export declare function getDevice(id: string): Device | undefined;
export declare function upsertDevice(device: Device): void;
export declare function deleteDevice(id: string): boolean;
export declare function getDiscoveredDevices(): DiscoveredDevice[];
export declare function addDiscoveredDevice(device: DiscoveredDevice): void;
export declare function removeDiscoveredDevice(id: string): void;
export declare function createDefaultConfig(deviceId: string, name: string, ip: string): DeviceConfig;
//# sourceMappingURL=index.d.ts.map