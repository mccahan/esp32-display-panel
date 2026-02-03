import { Router, Request, Response } from 'express';
import { getDiscoveredDevices, getDevice } from '../db';
import { adoptDevice } from '../services/deviceService';
import { triggerScan } from '../services/discoveryService';
import * as os from 'os';

const router = Router();

// Get server's IP address (for config)
function getServerIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

// GET /api/discovery/scan - Trigger mDNS scan
router.get('/scan', (req: Request, res: Response) => {
  triggerScan();
  res.json({ success: true, message: 'Scan triggered' });
});

// GET /api/discovery/devices - List discovered (unadopted) devices
router.get('/devices', (req: Request, res: Response) => {
  const discovered = getDiscoveredDevices();
  res.json(discovered.map(d => ({
    id: d.id,
    name: d.name,
    mac: d.mac,
    ip: d.ip,
    port: d.port,
    discoveredAt: d.discoveredAt,
    adopted: !!getDevice(d.id)
  })));
});

// POST /api/discovery/adopt/:id - Adopt a discovered device
router.post('/adopt/:id', (req: Request, res: Response) => {
  const discovered = getDiscoveredDevices().find(d => d.id === req.params.id);

  if (!discovered) {
    return res.status(404).json({ error: 'Device not found in discovered devices' });
  }

  const { name, location } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const serverIp = getServerIp();
  const device = adoptDevice(discovered, name, location || 'Unknown', serverIp);

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

export default router;
