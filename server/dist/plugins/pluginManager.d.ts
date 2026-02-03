import { Plugin, PluginConfig, ImportableDevice, ActionContext, ActionResult } from './types';
declare class PluginManager {
    private plugins;
    private configs;
    private initialized;
    loadConfigs(): Promise<void>;
    saveConfigs(): Promise<void>;
    registerPlugin(plugin: Plugin): void;
    initializePlugins(): Promise<void>;
    shutdown(): Promise<void>;
    getAllPlugins(): Plugin[];
    getPlugin(id: string): Plugin | undefined;
    getDeviceProviders(): Plugin[];
    discoverDevices(pluginId: string): Promise<ImportableDevice[]>;
    executeAction(ctx: ActionContext): Promise<ActionResult>;
    getPluginConfig(pluginId: string): PluginConfig | undefined;
    setPluginConfig(pluginId: string, config: Partial<PluginConfig>): Promise<void>;
    testConnection(pluginId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
export declare const pluginManager: PluginManager;
export {};
//# sourceMappingURL=pluginManager.d.ts.map