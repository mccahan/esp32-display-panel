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

**Browser:** Upload `.pio/build/esp32s3/firmware.bin` at `http://<device-ip>/update`

**curl:**
```bash
# Get MD5 hash and upload via ElegantOTA endpoints
MD5=$(md5 -q .pio/build/esp32s3/firmware.bin)
curl -s "http://<device-ip>/ota/start?mode=fr&hash=$MD5"
curl -X POST -F "file=@.pio/build/esp32s3/firmware.bin" http://<device-ip>/ota/upload
```

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

Plugins are located in `server/src/plugins/` and provide integrations with external smart home systems.

#### Creating a New Plugin

1. **Create plugin directory**: `server/src/plugins/my-plugin/`

2. **Implement the Plugin interface** in `index.ts`:

```typescript
import { Plugin, PluginConfig, ImportableDevice, ActionContext, ActionResult, DeviceState } from '../types';

class MyPlugin implements Plugin {
  id = 'my-plugin';           // Unique identifier (used in bindings)
  name = 'My Plugin';         // Display name in admin UI
  type: 'device-provider' = 'device-provider';
  description = 'Description for admin UI';
  pollingInterval = 30000;    // State polling interval (ms), default 30000

  private config: PluginConfig | null = null;

  async initialize(config: PluginConfig): Promise<void> {
    this.config = config;
    // Access settings via config.settings.myKey
    console.log(`[MyPlugin] Initialized`);
  }

  async shutdown(): Promise<void> {
    this.config = null;
  }

  // Return devices that can be bound to ESP32 buttons
  async discoverDevices(): Promise<ImportableDevice[]> {
    return [{
      id: 'device-123',
      name: 'My Device',
      type: 'switch',  // 'light' | 'switch' | 'fan' | 'outlet'
      room: 'Living Room',
      capabilities: { on: true, brightness: false, speed: false },
      metadata: { /* plugin-specific data */ }
    }];
  }

  // Execute button press action
  async executeAction(ctx: ActionContext): Promise<ActionResult> {
    const { binding, newState, speedLevel } = ctx;
    // binding.externalDeviceId - the device to control
    // binding.metadata - data from discoverDevices
    // newState - true=on, false=off
    // speedLevel - fan speed (0-100) if applicable

    try {
      // Call external API...
      return { success: true, newState };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Return current device state (called during polling)
  async getDeviceState(externalDeviceId: string): Promise<DeviceState | null> {
    // Fetch from external system
    return { state: true, speedLevel: undefined };
  }

  // Optional: test connection button in admin UI
  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Connected!' };
  }
}

export default new MyPlugin();
```

3. **Register the plugin** in `server/src/index.ts`:

```typescript
import myPlugin from './plugins/my-plugin';
// In main():
pluginManager.registerPlugin(myPlugin);
```

4. **Add routes** (optional) in `server/src/routes/plugins.ts` for custom configuration UI.

#### Plugin Types

| Type | Purpose |
|------|---------|
| `device-provider` | Discovers external devices, handles actions, polls state |
| `action-handler` | Only executes actions (no device discovery) |
| `http-action` | Simple HTTP request plugins using `getHttpConfig()` |

#### Key Interfaces

```typescript
interface ImportableDevice {
  id: string;           // External device ID
  name: string;
  type: 'light' | 'switch' | 'fan' | 'outlet';
  room?: string;
  capabilities: { on: boolean; brightness?: boolean; speed?: boolean };
  metadata: Record<string, any>;  // Stored in button binding
}

interface ActionContext {
  deviceId: string;     // ESP32 device ID
  buttonId: number;
  binding: ButtonBinding;
  newState: boolean;
  speedLevel?: number;
  timestamp: number;
}

interface DeviceState {
  state: boolean;
  speedLevel?: number;  // 0-100 for fans
}
```

#### Existing Plugins

| Plugin | Directory | Purpose |
|--------|-----------|---------|
| Homebridge | `homebridge/` | Integrates with Homebridge API for HomeKit devices |
| Timed Devices | `timed-devices/` | Creates buttons with scheduled on/off actions |

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
