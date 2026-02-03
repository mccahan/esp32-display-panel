"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const devices_1 = __importDefault(require("./routes/devices"));
const discovery_1 = __importDefault(require("./routes/discovery"));
const actions_1 = __importDefault(require("./routes/actions"));
const plugins_1 = __importDefault(require("./routes/plugins"));
const discoveryService_1 = require("./services/discoveryService");
const deviceService_1 = require("./services/deviceService");
const pluginManager_1 = require("./plugins/pluginManager");
// Import plugins
const homebridge_1 = __importDefault(require("./plugins/homebridge"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Static files for admin dashboard
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// API Routes
app.use('/api/devices', devices_1.default);
app.use('/api/discovery', discovery_1.default);
app.use('/api/action', actions_1.default);
app.use('/api/plugins', plugins_1.default);
// Simple ping endpoint
app.get('/api/ping', (req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
});
// Serve admin dashboard for all other routes
app.get('*', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/index.html'));
});
// Initialize plugins and start server
async function start() {
    // Register plugins
    pluginManager_1.pluginManager.registerPlugin(homebridge_1.default);
    // Initialize enabled plugins
    await pluginManager_1.pluginManager.initializePlugins();
    // Start server
    app.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`ESP32 Display Server running on port ${PORT}`);
        console.log(`========================================`);
        console.log(`Admin Dashboard: http://localhost:${PORT}`);
        console.log(`API Base URL:    http://localhost:${PORT}/api`);
        console.log(`========================================\n`);
        // Start mDNS discovery
        (0, discoveryService_1.startDiscovery)();
        // Start periodic health checks (every 60 seconds)
        (0, deviceService_1.startHealthChecks)(60000);
    });
}
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await pluginManager_1.pluginManager.shutdown();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await pluginManager_1.pluginManager.shutdown();
    process.exit(0);
});
start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map