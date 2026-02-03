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
const express_1 = require("express");
const db_1 = require("../db");
const deviceService_1 = require("../services/deviceService");
const discoveryService_1 = require("../services/discoveryService");
const os = __importStar(require("os"));
const router = (0, express_1.Router)();
// Get server's IP address (for config)
function getServerIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface)
            continue;
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return '127.0.0.1';
}
// GET /api/discovery/scan - Trigger mDNS scan
router.get('/scan', (req, res) => {
    (0, discoveryService_1.triggerScan)();
    res.json({ success: true, message: 'Scan triggered' });
});
// GET /api/discovery/devices - List discovered (unadopted) devices
router.get('/devices', (req, res) => {
    const discovered = (0, db_1.getDiscoveredDevices)();
    res.json(discovered.map(d => ({
        id: d.id,
        name: d.name,
        mac: d.mac,
        ip: d.ip,
        port: d.port,
        discoveredAt: d.discoveredAt,
        adopted: !!(0, db_1.getDevice)(d.id)
    })));
});
// POST /api/discovery/adopt/:id - Adopt a discovered device
router.post('/adopt/:id', (req, res) => {
    const discovered = (0, db_1.getDiscoveredDevices)().find(d => d.id === req.params.id);
    if (!discovered) {
        return res.status(404).json({ error: 'Device not found in discovered devices' });
    }
    const { name, location } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    const serverIp = getServerIp();
    const device = (0, deviceService_1.adoptDevice)(discovered, name, location || 'Unknown', serverIp);
    res.json({
        success: true,
        message: 'Device adopted',
        device: {
            id: device.id,
            name: device.name,
            location: device.location,
            ip: device.ip
        }
    });
});
exports.default = router;
//# sourceMappingURL=discovery.js.map