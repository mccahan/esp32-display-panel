import express from 'express';
import cors from 'cors';
import path from 'path';

import devicesRouter from './routes/devices';
import discoveryRouter from './routes/discovery';
import actionsRouter from './routes/actions';
import pluginsRouter from './routes/plugins';
import { startDiscovery } from './services/discoveryService';
import { startHealthChecks, stopHealthChecks } from './services/deviceService';
import { startStatePolling, stopStatePolling } from './services/stateSyncService';
import { pluginManager } from './plugins/pluginManager';

// Import plugins
import homebridgePlugin from './plugins/homebridge';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Static files for admin dashboard
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/devices', devicesRouter);
app.use('/api/discovery', discoveryRouter);
app.use('/api/action', actionsRouter);
app.use('/api/plugins', pluginsRouter);

// Simple ping endpoint
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// Serve admin dashboard for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize plugins and start server
async function start() {
  // Register plugins
  pluginManager.registerPlugin(homebridgePlugin);

  // Initialize enabled plugins
  await pluginManager.initializePlugins();

  // Start server
  app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`ESP32 Display Server running on port ${PORT}`);
    console.log(`========================================`);
    console.log(`Admin Dashboard: http://localhost:${PORT}`);
    console.log(`API Base URL:    http://localhost:${PORT}/api`);
    console.log(`========================================\n`);

    // Start mDNS discovery
    startDiscovery();

    // Start periodic health checks (every 60 seconds)
    startHealthChecks(60000);

    // Start state polling for external device changes (every 30 seconds)
    startStatePolling(30000);
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  stopStatePolling();
  stopHealthChecks();
  await pluginManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  stopStatePolling();
  stopHealthChecks();
  await pluginManager.shutdown();
  process.exit(0);
});

start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
