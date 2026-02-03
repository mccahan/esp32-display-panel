import * as fs from 'fs';
import * as path from 'path';
import { ButtonBinding } from '../plugins/types';

// Data directory path
const DATA_DIR = path.join(__dirname, '../../data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const SCENES_FILE = path.join(DATA_DIR, 'scenes.json');

// Re-export ButtonBinding for convenience
export { ButtonBinding } from '../plugins/types';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// LCARS text field interface
export interface LCARSTextField {
  id: string;
  value: string;
  style: 'title' | 'label' | 'data' | 'status';
}

// LCARS configuration
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

// Day/night mode configuration
export interface DayNightConfig {
  enabled: boolean;
  dayTheme: string;
  nightTheme: string;
  dayStartHour: number;
  nightStartHour: number;
}

// Button configuration
export interface ButtonConfig {
  id: number;
  type: 'light' | 'switch' | 'fan' | 'scene';
  name: string;
  icon: string;
  state: boolean;
  subtitle?: string;  // For LCARS
  speedSteps?: number;  // For fans
  speedLevel?: number;  // Current fan speed (0-100)
  // Plugin binding for external device control
  binding?: ButtonBinding;
  // Scene ID for scene-type buttons
  sceneId?: string;
}

// Scene configuration (per-device, references global scene)
export interface SceneConfig {
  id: number;
  name: string;
  icon: string;
  globalSceneId?: string;  // Reference to global scene definition
}

// ============================================================================
// Global Scene Definitions
// ============================================================================

// Action to perform on a device when scene is activated
export interface SceneAction {
  pluginId: string;
  externalDeviceId: string;
  deviceName: string;        // For display purposes
  deviceType: string;        // light, switch, fan, etc.
  targetState: boolean;      // On or off
  targetSpeedLevel?: number; // For fans
}

// Global scene definition
export interface GlobalScene {
  id: string;
  name: string;
  icon: string;
  actions: SceneAction[];
  createdAt: number;
  updatedAt: number;
}

// Display configuration
export interface DisplayConfig {
  brightness: number;
  theme: 'light_mode' | 'neon_cyberpunk' | 'dark_clean' | 'lcars';
  dayNightMode: DayNightConfig;
  lcars: LCARSConfig;
}

// Server configuration
export interface ServerConfig {
  host: string;
  port: number;
  reportingUrl?: string;  // Full URL for device to report to (may differ from host:port due to Docker/proxy)
}

// Device information
export interface DeviceInfo {
  id: string;
  name: string;
  location: string;
}

// Full device configuration (sent to ESP32)
export interface DeviceConfig {
  version: number;
  device: DeviceInfo;
  display: DisplayConfig;
  buttons: ButtonConfig[];
  scenes: SceneConfig[];
  server: ServerConfig;
}

// Device record (stored in server)
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

// Discovered device (from mDNS)
export interface DiscoveredDevice {
  id: string;
  name: string;
  mac: string;
  ip: string;
  port: number;
  discoveredAt: number;
}

// Device database
let devices: Map<string, Device> = new Map();
let discoveredDevices: Map<string, DiscoveredDevice> = new Map();

// Load devices from file
export function loadDevices(): void {
  try {
    if (fs.existsSync(DEVICES_FILE)) {
      const data = fs.readFileSync(DEVICES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      devices = new Map(Object.entries(parsed));
      console.log(`Loaded ${devices.size} devices from storage`);
    }
  } catch (error) {
    console.error('Failed to load devices:', error);
    devices = new Map();
  }
}

// Save devices to file
export function saveDevices(): void {
  try {
    const data = Object.fromEntries(devices);
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save devices:', error);
  }
}

// Get all adopted devices
export function getAllDevices(): Device[] {
  return Array.from(devices.values()).filter(d => d.adopted);
}

// Get device by ID
export function getDevice(id: string): Device | undefined {
  return devices.get(id);
}

// Add or update device
export function upsertDevice(device: Device): void {
  devices.set(device.id, device);
  saveDevices();
}

// Delete device
export function deleteDevice(id: string): boolean {
  const result = devices.delete(id);
  if (result) saveDevices();
  return result;
}

// Get discovered (unadopted) devices
export function getDiscoveredDevices(): DiscoveredDevice[] {
  return Array.from(discoveredDevices.values()).filter(d => !devices.has(d.id));
}

// Add discovered device
export function addDiscoveredDevice(device: DiscoveredDevice): void {
  discoveredDevices.set(device.id, device);
}

// Remove discovered device
export function removeDiscoveredDevice(id: string): void {
  discoveredDevices.delete(id);
}

// Create default device config
export function createDefaultConfig(deviceId: string, name: string, ip: string): DeviceConfig {
  return {
    version: 1,
    device: {
      id: deviceId,
      name: name,
      location: 'Unknown'
    },
    display: {
      brightness: 80,
      theme: 'dark_clean',
      dayNightMode: {
        enabled: false,
        dayTheme: 'light_mode',
        nightTheme: 'dark_clean',
        dayStartHour: 7,
        nightStartHour: 20
      },
      lcars: {
        enabled: false,
        colorScheme: 'federation',
        headerLeft: 'STARDATE',
        headerRight: 'ONLINE',
        footerLeft: '',
        footerRight: '',
        sidebarTop: '',
        sidebarBottom: '',
        customFields: []
      }
    },
    buttons: [
      { id: 1, type: 'light', name: 'Living Room', icon: 'charge', state: false },
      { id: 2, type: 'light', name: 'Bedroom', icon: 'charge', state: false },
      { id: 3, type: 'light', name: 'Kitchen', icon: 'charge', state: false },
      { id: 4, type: 'light', name: 'Bathroom', icon: 'charge', state: false }
    ],
    scenes: [
      { id: 1, name: 'All Off', icon: 'power' },
      { id: 2, name: 'All On', icon: 'ok' }
    ],
    server: {
      host: ip,
      port: 3000
    }
  };
}

// ============================================================================
// Global Scenes Storage
// ============================================================================

let globalScenes: Map<string, GlobalScene> = new Map();

// Load global scenes from file
export function loadGlobalScenes(): void {
  try {
    if (fs.existsSync(SCENES_FILE)) {
      const data = fs.readFileSync(SCENES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      globalScenes = new Map(Object.entries(parsed));
      console.log(`Loaded ${globalScenes.size} global scenes from storage`);
    }
  } catch (error) {
    console.error('Failed to load global scenes:', error);
    globalScenes = new Map();
  }
}

// Save global scenes to file
export function saveGlobalScenes(): void {
  try {
    const data = Object.fromEntries(globalScenes);
    fs.writeFileSync(SCENES_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save global scenes:', error);
  }
}

// Get all global scenes
export function getAllGlobalScenes(): GlobalScene[] {
  return Array.from(globalScenes.values());
}

// Get global scene by ID
export function getGlobalScene(id: string): GlobalScene | undefined {
  return globalScenes.get(id);
}

// Create or update global scene
export function upsertGlobalScene(scene: GlobalScene): void {
  globalScenes.set(scene.id, scene);
  saveGlobalScenes();
}

// Delete global scene
export function deleteGlobalScene(id: string): boolean {
  const result = globalScenes.delete(id);
  if (result) saveGlobalScenes();
  return result;
}

// Generate unique scene ID
export function generateSceneId(): string {
  return 'scene-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Initialize
loadDevices();
loadGlobalScenes();
