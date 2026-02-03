# Claude Agent Instructions

ESP32 smart display project with Bun/TypeScript management server and plugin system.

## Project Structure

```
├── src/                    # ESP32 firmware (C++/LVGL)
├── include/                # ESP32 headers
├── server/                 # Bun/TypeScript management server
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── routes/         # API route handlers
│   │   ├── services/       # Business logic
│   │   │   ├── deviceService.ts      # Device communication
│   │   │   ├── stateSyncService.ts   # Plugin state polling
│   │   │   └── discoveryService.ts   # mDNS device discovery
│   │   ├── plugins/        # Plugin system
│   │   │   ├── types.ts              # Plugin interfaces
│   │   │   ├── pluginManager.ts      # Plugin lifecycle
│   │   │   └── homebridge/           # Homebridge integration
│   │   └── db/             # Data persistence
│   ├── public/             # Admin dashboard (HTML/JS)
│   └── data/               # Runtime data (devices.json, plugins.json)
├── DISPLAY-CLAUDE.md       # Hardware specs and ESP32 API reference
└── README.md               # Project overview
```

## Key Files

| File | Purpose |
|------|---------|
| `DISPLAY-CLAUDE.md` | Hardware specs, pin mappings, ESP32 API reference |
| `src/ui_manager.cpp` | LVGL UI creation, themes, button cards |
| `src/device_controller.cpp` | Button actions, server communication |
| `server/src/services/stateSyncService.ts` | Polls plugins, pushes states to ESP32 |
| `server/src/plugins/types.ts` | Plugin interface definitions |
| `server/public/index.html` | Admin dashboard UI |

## Common Tasks

### Build & Flash ESP32
```bash
pio run -t upload
```

### Build & Run Server
```bash
cd server
bun run build
bun start
```

### Take a Screenshot
```bash
curl -X POST http://<device-ip>/api/screenshot/capture
curl -o screenshot.bmp http://<device-ip>/api/screenshot/download
```

### OTA Firmware Update
Upload `.pio/build/esp32s3/firmware.bin` at `http://<device-ip>/update`

## Server Architecture

### State Sync Service

The `stateSyncService.ts` handles bi-directional state synchronization:

1. **Initial Sync** - On startup, polls all plugins and pushes states to all devices
2. **Periodic Polling** - Each plugin has its own polling interval (default 30s, Homebridge 15s)
3. **Heartbeat Push** - Forces state push every 60s even if no changes detected
4. **Change Detection** - Only pushes to ESP32 when external state differs from local

Key functions:
- `startStatePolling()` - Starts the sync service
- `forcePluginPoll(pluginId)` - Immediate poll of specific plugin
- `forceDevicePush(deviceId)` - Immediate push to specific device

### Plugin System

Plugins implement the `Plugin` interface:

```typescript
interface Plugin {
  id: string;
  name: string;
  type: 'device-provider' | 'action-handler' | 'http-action';
  pollingInterval?: number;  // ms, default 30000

  initialize(config: PluginConfig): Promise<void>;
  shutdown(): Promise<void>;
  discoverDevices?(): Promise<ImportableDevice[]>;
  executeAction?(ctx: ActionContext): Promise<ActionResult>;
  getDeviceState?(externalDeviceId: string): Promise<DeviceState | null>;
}
```

### Admin Dashboard Routes

Hash-based routing in `public/index.html`:
- `#/` or `#/device/{id}` - Devices tab
- `#/discover` - Device discovery
- `#/plugins` or `#/plugins/{id}` - Plugin configuration

## ESP32 State Update Endpoint

`POST /api/state/buttons` receives button state updates:

```json
{
  "buttons": [
    { "id": 1, "state": true },
    { "id": 2, "state": false, "speedLevel": 2 }
  ]
}
```

**Important**: The `speedLevel` field triggers fan-specific handling. Only include it for fan-type buttons.

## Debugging

### Server Logs
The state sync service logs polling activity:
```
[StateSync] Plugin "Homebridge" polling interval: 15s
[StateSync] Force pushing 4 button states to Living Room Panel
[DeviceService] Successfully pushed states to Living Room Panel
```

### ESP32 Serial Output
Monitor with `pio device monitor` for:
- WiFi connection status
- Config reception
- Button state updates

## Data Files

- `server/data/devices.json` - Adopted devices and their configurations
- `server/data/plugins.json` - Plugin configurations and credentials

## Before Making Changes

1. Read `DISPLAY-CLAUDE.md` for hardware/API details
2. Check `server/src/plugins/types.ts` for interface definitions
3. Run `bun run build` in server/ to catch TypeScript errors
4. Test with `bun start` and check console logs
