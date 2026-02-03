"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDevices = loadDevices;
exports.saveDevices = saveDevices;
exports.getAllDevices = getAllDevices;
exports.getDevice = getDevice;
exports.upsertDevice = upsertDevice;
exports.deleteDevice = deleteDevice;
exports.getDiscoveredDevices = getDiscoveredDevices;
exports.addDiscoveredDevice = addDiscoveredDevice;
exports.removeDiscoveredDevice = removeDiscoveredDevice;
exports.createDefaultConfig = createDefaultConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Data directory path
const DATA_DIR = path.join(__dirname, '../../data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
// Device database
let devices = new Map();
let discoveredDevices = new Map();
// Load devices from file
function loadDevices() {
    try {
        if (fs.existsSync(DEVICES_FILE)) {
            const data = fs.readFileSync(DEVICES_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            devices = new Map(Object.entries(parsed));
            console.log(`Loaded ${devices.size} devices from storage`);
        }
    }
    catch (error) {
        console.error('Failed to load devices:', error);
        devices = new Map();
    }
}
// Save devices to file
function saveDevices() {
    try {
        const data = Object.fromEntries(devices);
        fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2));
    }
    catch (error) {
        console.error('Failed to save devices:', error);
    }
}
// Get all adopted devices
function getAllDevices() {
    return Array.from(devices.values()).filter(d => d.adopted);
}
// Get device by ID
function getDevice(id) {
    return devices.get(id);
}
// Add or update device
function upsertDevice(device) {
    devices.set(device.id, device);
    saveDevices();
}
// Delete device
function deleteDevice(id) {
    const result = devices.delete(id);
    if (result)
        saveDevices();
    return result;
}
// Get discovered (unadopted) devices
function getDiscoveredDevices() {
    return Array.from(discoveredDevices.values()).filter(d => !devices.has(d.id));
}
// Add discovered device
function addDiscoveredDevice(device) {
    discoveredDevices.set(device.id, device);
}
// Remove discovered device
function removeDiscoveredDevice(id) {
    discoveredDevices.delete(id);
}
// Create default device config
function createDefaultConfig(deviceId, name, ip) {
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
// Initialize
loadDevices();
//# sourceMappingURL=index.js.map