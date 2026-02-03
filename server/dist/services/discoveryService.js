"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDiscovery = startDiscovery;
exports.stopDiscovery = stopDiscovery;
exports.triggerScan = triggerScan;
const bonjour_service_1 = __importDefault(require("bonjour-service"));
const db_1 = require("../db");
const bonjour = new bonjour_service_1.default();
let browser = null;
// Start mDNS discovery
function startDiscovery() {
    if (browser) {
        console.log('Discovery already running');
        return;
    }
    console.log('Starting mDNS discovery for _esp32display._tcp...');
    browser = bonjour.find({ type: 'esp32display' }, (service) => {
        console.log('Discovered device:', service.name, service.addresses);
        // Extract device info from TXT records
        const txt = service.txt || {};
        const id = txt.id || service.name;
        const mac = txt.mac || 'unknown';
        const name = txt.name || service.name;
        // Get first IPv4 address
        const ip = service.addresses?.find(addr => !addr.includes(':')) || service.host;
        const device = {
            id,
            name,
            mac,
            ip,
            port: service.port,
            discoveredAt: Date.now()
        };
        (0, db_1.addDiscoveredDevice)(device);
        console.log(`Added discovered device: ${id} at ${ip}:${service.port}`);
    });
}
// Stop discovery
function stopDiscovery() {
    if (browser) {
        browser.stop();
        browser = null;
        console.log('mDNS discovery stopped');
    }
}
// Trigger a manual scan (discovery is continuous, but this logs the current state)
function triggerScan() {
    console.log('Manual scan triggered - discovery is continuous');
    // The browser is already running and will pick up new devices
}
// Cleanup on exit
process.on('beforeExit', () => {
    stopDiscovery();
    bonjour.destroy();
});
//# sourceMappingURL=discoveryService.js.map