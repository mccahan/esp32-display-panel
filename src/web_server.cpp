#include "web_server.h"
#include "config_manager.h"
#include "device_controller.h"
#include "ui_manager.h"
#include "theme_engine.h"
#include "brightness_scheduler.h"
#include "theme_scheduler.h"
#include "time_manager.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <ElegantOTA.h>
#include <Preferences.h>
#include <esp_timer.h>

// Global instance
DisplayWebServer webServer;

DisplayWebServer::DisplayWebServer() : server(80) {
}

void DisplayWebServer::begin() {
    setupRoutes();
    setupOTA();
    server.begin();
    Serial.println("Web server started on port 80");
}

String DisplayWebServer::getIPAddress() {
    return WiFi.localIP().toString();
}

void DisplayWebServer::setupOTA() {
    // ElegantOTA provides a nice web UI for firmware updates
    ElegantOTA.begin(&server);
    ElegantOTA.setAutoReboot(true);  // Auto reboot after successful update

    // OTA progress callbacks
    ElegantOTA.onStart([]() {
        Serial.println("\n========================================");
        Serial.println("OTA Update Started");
        Serial.println("========================================");

        // Show the OTA update screen with spinner
        uiManager.showOTAScreen();
    });

    ElegantOTA.onProgress([](size_t current, size_t total) {
        static int lastPercent = -1;
        int percent = (current * 100) / total;
        // Only log every 10% - no UI updates during OTA to avoid tearing
        if (percent / 10 != lastPercent / 10) {
            lastPercent = percent;
            Serial.printf("OTA Progress: %d%% (%u / %u bytes)\n", percent, current, total);
        }
    });

    ElegantOTA.onEnd([](bool success) {
        Serial.println("\n========================================");
        if (success) {
            Serial.println("OTA Update Complete!");
            Serial.println("Rebooting...");
            Serial.println("========================================\n");
            // Delay reboot slightly to allow HTTP response to be sent
            // Can't use delay() here as it blocks the response, so schedule via timer
            static esp_timer_handle_t reboot_timer = nullptr;
            if (!reboot_timer) {
                esp_timer_create_args_t timer_args = {};
                timer_args.callback = [](void*) { ESP.restart(); };
                timer_args.name = "reboot";
                esp_timer_create(&timer_args, &reboot_timer);
            }
            esp_timer_start_once(reboot_timer, 100000); // 100ms delay
        } else {
            Serial.println("OTA Update FAILED!");
            Serial.println("========================================\n");
        }
    });

    Serial.println("OTA updates available at /update");
}

void DisplayWebServer::setupRoutes() {
    // Root page - simple dashboard
    server.on("/", HTTP_GET, [this](AsyncWebServerRequest *request) {
        request->send(200, "text/html", getIndexPage());
    });

    // API: Get device info
    server.on("/api/info", HTTP_GET, [](AsyncWebServerRequest *request) {
        StaticJsonDocument<768> doc;
        doc["chip_model"] = ESP.getChipModel();
        doc["chip_revision"] = ESP.getChipRevision();
        doc["cpu_freq_mhz"] = ESP.getCpuFreqMHz();
        doc["flash_size"] = ESP.getFlashChipSize();
        doc["free_heap"] = ESP.getFreeHeap();
        doc["free_psram"] = ESP.getFreePsram();
        doc["total_psram"] = ESP.getPsramSize();
        doc["uptime_seconds"] = millis() / 1000;
        doc["ip_address"] = WiFi.localIP().toString();
        doc["mac_address"] = WiFi.macAddress();
        doc["reporting_url"] = configManager.getConfig().server.reportingUrl;

        // Time information
        doc["time_synced"] = timeManager.isSynced();
        if (timeManager.isSynced()) {
            char timeStr[6];
            snprintf(timeStr, sizeof(timeStr), "%02d:%02d",
                timeManager.getCurrentHour(), timeManager.getCurrentMinute());
            doc["current_time"] = timeStr;
        }

        // Schedule information
        const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;
        doc["schedule_enabled"] = schedule.enabled;
        doc["current_brightness"] = uiManager.getBrightness();

        if (schedule.enabled && timeManager.isSynced()) {
            // Find active period
            uint8_t hour = timeManager.getCurrentHour();
            uint8_t minute = timeManager.getCurrentMinute();
            uint16_t currentMinutes = hour * 60 + minute;

            int8_t activePeriod = schedule.periodCount > 0 ? schedule.periodCount - 1 : -1;
            for (uint8_t i = 0; i < schedule.periodCount; i++) {
                uint16_t periodStart = schedule.periods[i].startHour * 60 + schedule.periods[i].startMinute;
                if (periodStart <= currentMinutes) {
                    activePeriod = i;
                } else {
                    break;
                }
            }

            if (activePeriod >= 0 && activePeriod < schedule.periodCount) {
                doc["current_period"] = schedule.periods[activePeriod].name;
                doc["scheduled_brightness"] = schedule.periods[activePeriod].brightness;
            }
        }

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // API: Capture screenshot
    server.on("/api/screenshot/capture", HTTP_POST, [](AsyncWebServerRequest *request) {
        bool success = captureScreenshot();

        StaticJsonDocument<128> doc;
        doc["success"] = success;
        if (success) {
            doc["size"] = getScreenshotSize();
            doc["message"] = "Screenshot captured";
        } else {
            doc["message"] = "Failed to capture screenshot";
        }

        String response;
        serializeJson(doc, response);
        request->send(success ? 200 : 500, "application/json", response);
    });

    // API: Download screenshot
    server.on("/api/screenshot/download", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (!hasScreenshot()) {
            request->send(404, "application/json", "{\"error\":\"No screenshot available\"}");
            return;
        }

        const uint8_t* data = getScreenshotData();
        size_t size = getScreenshotSize();

        // Send as downloadable BMP file
        AsyncWebServerResponse *response = request->beginResponse(
            200, "image/bmp", data, size
        );
        response->addHeader("Content-Disposition", "attachment; filename=\"screenshot.bmp\"");
        request->send(response);
    });

    // API: View screenshot in browser
    server.on("/api/screenshot/view", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (!hasScreenshot()) {
            request->send(404, "application/json", "{\"error\":\"No screenshot available\"}");
            return;
        }

        const uint8_t* data = getScreenshotData();
        size_t size = getScreenshotSize();

        // Send as inline image (viewable in browser)
        AsyncWebServerResponse *response = request->beginResponse(
            200, "image/bmp", data, size
        );
        response->addHeader("Content-Disposition", "inline; filename=\"screenshot.bmp\"");
        request->send(response);
    });

    // API: Screenshot status
    server.on("/api/screenshot/status", HTTP_GET, [](AsyncWebServerRequest *request) {
        StaticJsonDocument<128> doc;
        doc["available"] = hasScreenshot();
        if (hasScreenshot()) {
            doc["size"] = getScreenshotSize();
        }

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // API: Delete screenshot
    server.on("/api/screenshot/delete", HTTP_POST, [](AsyncWebServerRequest *request) {
        deleteScreenshot();

        StaticJsonDocument<64> doc;
        doc["success"] = true;
        doc["message"] = "Screenshot deleted";

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // API: Restart device
    server.on("/api/restart", HTTP_POST, [](AsyncWebServerRequest *request) {
        request->send(200, "application/json", "{\"message\":\"Restarting...\"}");
        delay(100);
        ESP.restart();
    });

    // API: Get WiFi status
    server.on("/api/wifi/status", HTTP_GET, [](AsyncWebServerRequest *request) {
        StaticJsonDocument<256> doc;
        doc["connected"] = (WiFi.status() == WL_CONNECTED);
        doc["mode"] = (WiFi.getMode() == WIFI_AP) ? "ap" : "station";
        doc["ssid"] = WiFi.SSID();
        doc["ip"] = WiFi.localIP().toString();
        doc["rssi"] = WiFi.RSSI();

        if (WiFi.getMode() == WIFI_AP) {
            doc["ap_ip"] = WiFi.softAPIP().toString();
            doc["ap_ssid"] = "ESP32-Display";
        }

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // API: Scan WiFi networks
    server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest *request) {
        int n = WiFi.scanNetworks();
        StaticJsonDocument<2048> doc;
        JsonArray networks = doc.createNestedArray("networks");

        for (int i = 0; i < n && i < 20; i++) {
            JsonObject net = networks.createNestedObject();
            net["ssid"] = WiFi.SSID(i);
            net["rssi"] = WiFi.RSSI(i);
            net["secure"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
        }

        WiFi.scanDelete();

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // API: Connect to WiFi (with body handler for POST data)
    server.on("/api/wifi/connect", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response is sent after body is processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            StaticJsonDocument<256> doc;
            DeserializationError error = deserializeJson(doc, data, len);

            if (error) {
                request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
                return;
            }

            const char* ssid = doc["ssid"];
            const char* password = doc["password"] | "";

            if (!ssid || strlen(ssid) == 0) {
                request->send(400, "application/json", "{\"error\":\"SSID required\"}");
                return;
            }

            // Save credentials
            Preferences prefs;
            prefs.begin("wifi", false);
            prefs.putString("ssid", ssid);
            prefs.putString("password", password);
            prefs.end();

            StaticJsonDocument<128> response;
            response["success"] = true;
            response["message"] = "WiFi credentials saved. Restarting...";

            String responseStr;
            serializeJson(response, responseStr);
            request->send(200, "application/json", responseStr);

            // Restart to apply new WiFi settings
            delay(500);
            ESP.restart();
        }
    );

    // ========================================================================
    // New API endpoints for configurable display system
    // ========================================================================

    // API: Simple ping endpoint for server connectivity check
    server.on("/api/ping", HTTP_GET, [](AsyncWebServerRequest *request) {
        request->send(200, "application/json", "{\"pong\":true}");
    });

    // API: Get current configuration
    server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest *request) {
        String json = configManager.toJson();
        request->send(200, "application/json", json);
    });

    // API: Receive new configuration from server (POST)
    // Static buffer to accumulate chunked body data
    static String configBodyBuffer;

    server.on("/api/config", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Called when request completes - process accumulated body
            if (configBodyBuffer.length() > 0) {
                Serial.printf("WebServer: Processing config (%d bytes)\n", configBodyBuffer.length());

                if (configManager.parseConfigJson(configBodyBuffer)) {
                    configManager.saveConfig();

                    // Refresh schedulers BEFORE requesting rebuild so theme/brightness
                    // are set correctly when the UI rebuilds
                    brightnessScheduler.refresh();
                    themeScheduler.refresh();

                    // Request UI rebuild (will be done in main loop for thread safety)
                    uiManager.requestRebuild();

                    request->send(200, "application/json", "{\"success\":true,\"message\":\"Config applied\"}");
                } else {
                    request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid config JSON\"}");
                }
                configBodyBuffer = "";  // Clear buffer
            } else {
                request->send(400, "application/json", "{\"success\":false,\"error\":\"No config data received\"}");
            }
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            // Accumulate body chunks
            if (index == 0) {
                configBodyBuffer = "";  // Reset on first chunk
                configBodyBuffer.reserve(total);  // Pre-allocate
            }

            // Append this chunk
            for (size_t i = 0; i < len; i++) {
                configBodyBuffer += (char)data[i];
            }

            Serial.printf("WebServer: Received config chunk %d-%d of %d\n", index, index + len, total);
        }
    );

    // API: Get current device state
    server.on("/api/state", HTTP_GET, [](AsyncWebServerRequest *request) {
        String json = deviceController.getStateJson();
        request->send(200, "application/json", json);
    });

    // API: Receive state update from server (POST)
    server.on("/api/state", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response sent after body processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            String json = String((char*)data).substring(0, len);
            deviceController.processServerStateUpdate(json);
            request->send(200, "application/json", "{\"success\":true}");
        }
    );

    // API: Receive button state updates (POST) - for state sync from server
    server.on("/api/state/buttons", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response sent after body processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            String json = String((char*)data).substring(0, len);
            deviceController.processServerStateUpdate(json);
            request->send(200, "application/json", "{\"success\":true}");
        }
    );

    // API: Set brightness (POST)
    server.on("/api/brightness", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response sent after body processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            StaticJsonDocument<64> doc;
            DeserializationError error = deserializeJson(doc, data, len);

            if (error) {
                request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
                return;
            }

            int brightness = doc["brightness"] | -1;
            if (brightness < 0 || brightness > 100) {
                request->send(400, "application/json", "{\"error\":\"Brightness must be 0-100\"}");
                return;
            }

            uiManager.setBrightness(brightness);
            configManager.getConfigMutable().display.brightness = brightness;

            StaticJsonDocument<64> response;
            response["success"] = true;
            response["brightness"] = brightness;

            String responseStr;
            serializeJson(response, responseStr);
            request->send(200, "application/json", responseStr);
        }
    );

    // API: Change theme (POST)
    server.on("/api/theme", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response sent after body processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            StaticJsonDocument<128> doc;
            DeserializationError error = deserializeJson(doc, data, len);

            if (error) {
                request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
                return;
            }

            const char* theme = doc["theme"];
            if (!theme) {
                request->send(400, "application/json", "{\"error\":\"Theme name required\"}");
                return;
            }

            // Validate theme exists
            if (themeEngine.getThemeByName(theme) == nullptr) {
                request->send(400, "application/json", "{\"error\":\"Unknown theme\"}");
                return;
            }

            // Update config and request UI rebuild
            configManager.getConfigMutable().display.theme = theme;
            uiManager.requestRebuild();

            StaticJsonDocument<128> response;
            response["success"] = true;
            response["theme"] = theme;

            String responseStr;
            serializeJson(response, responseStr);
            request->send(200, "application/json", responseStr);
        }
    );

    // API: Request server change (POST) - requires user confirmation on panel
    server.on("/api/server", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            // Response sent after body processed
        },
        NULL,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            StaticJsonDocument<256> doc;
            DeserializationError error = deserializeJson(doc, data, len);

            if (error) {
                request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
                return;
            }

            const char* reportingUrl = doc["reportingUrl"];

            if (!reportingUrl || strlen(reportingUrl) == 0) {
                request->send(400, "application/json", "{\"error\":\"reportingUrl required\"}");
                return;
            }

            // Basic URL validation
            String url = String(reportingUrl);
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                request->send(400, "application/json", "{\"error\":\"reportingUrl must start with http:// or https://\"}");
                return;
            }

            // Check if URL matches current configuration - no change needed
            const DeviceConfig& config = configManager.getConfig();
            if (url == config.server.reportingUrl) {
                request->send(200, "application/json", "{\"success\":true,\"message\":\"URL already configured\"}");
                return;
            }

            // Check if a server change is already pending
            if (uiManager.isServerChangePending()) {
                request->send(409, "application/json", "{\"error\":\"Server change already pending user confirmation\"}");
                return;
            }

            // Show confirmation dialog to user
            uiManager.showServerChangeConfirmation(url);

            StaticJsonDocument<256> response;
            response["success"] = true;
            response["message"] = "Server change request sent to panel for user confirmation";
            response["reportingUrl"] = reportingUrl;

            String responseStr;
            serializeJson(response, responseStr);
            request->send(202, "application/json", responseStr);  // 202 Accepted - pending confirmation
        }
    );

    // API: Get current server configuration
    server.on("/api/server", HTTP_GET, [](AsyncWebServerRequest *request) {
        const DeviceConfig& config = configManager.getConfig();

        StaticJsonDocument<256> doc;
        doc["reportingUrl"] = config.server.reportingUrl;

        String response;
        serializeJson(doc, response);
        request->send(200, "application/json", response);
    });

    // Log 404 errors
    server.onNotFound([](AsyncWebServerRequest *request) {
        Serial.printf("WebServer: 404 Not Found - %s %s\n",
            request->methodToString(),
            request->url().c_str());
        request->send(404, "application/json", "{\"error\":\"Not found\"}");
    });
}

String DisplayWebServer::getIndexPage() {
    return R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ESP32 Display Controller</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #00d4ff; margin-bottom: 20px; }
        .card {
            background: #16213e;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            border: 1px solid #0f3460;
        }
        .card h2 { color: #00d4ff; margin-bottom: 15px; font-size: 1.2em; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; }
        .info-item { background: #0f3460; padding: 12px; border-radius: 8px; }
        .info-label { color: #888; font-size: 0.85em; margin-bottom: 4px; }
        .info-value { font-size: 1.1em; font-weight: 500; }
        .btn {
            background: #00d4ff;
            color: #1a1a2e;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 1em;
            cursor: pointer;
            margin-right: 10px;
            margin-bottom: 10px;
            transition: background 0.2s;
        }
        .btn:hover { background: #00b8e6; }
        .btn-secondary { background: #0f3460; color: #eee; }
        .btn-secondary:hover { background: #1a4a7a; }
        .btn-danger { background: #e94560; }
        .btn-danger:hover { background: #d13550; }
        .screenshot-container { text-align: center; margin-top: 15px; }
        .screenshot-container img {
            max-width: 100%;
            border-radius: 8px;
            border: 2px solid #0f3460;
        }
        .status { padding: 8px 16px; border-radius: 4px; display: inline-block; margin-top: 10px; }
        .status-success { background: #0f5132; color: #75b798; }
        .status-error { background: #5c1a1a; color: #ea868f; }
        #screenshot-status { margin-bottom: 15px; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; color: #888; margin-bottom: 5px; }
        .form-group input, .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #0f3460;
            border-radius: 6px;
            background: #0f3460;
            color: #eee;
            font-size: 1em;
        }
        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #00d4ff;
        }
        .network-list { max-height: 200px; overflow-y: auto; margin-bottom: 15px; }
        .network-item {
            padding: 10px;
            background: #0f3460;
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .network-item:hover { background: #1a4a7a; }
        .signal { font-size: 0.9em; color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <h1>ESP32 Display Controller</h1>

        <div class="card">
            <h2>Device Information</h2>
            <div class="info-grid" id="device-info">
                <div class="info-item">
                    <div class="info-label">Loading...</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>Server Configuration</h2>
            <div class="form-group">
                <label>Reporting URL</label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="reporting-url-input" placeholder="http://server:port">
                    <button class="btn" onclick="saveReportingUrl()" style="margin: 0; white-space: nowrap;">Update</button>
                </div>
            </div>
            <div id="reporting-url-status"></div>
        </div>

        <div class="card">
            <h2>Screenshot</h2>
            <div id="screenshot-status"></div>
            <button class="btn" onclick="captureScreenshot()">Capture Screenshot</button>
            <button class="btn btn-secondary" onclick="viewScreenshot()">View</button>
            <button class="btn btn-secondary" onclick="downloadScreenshot()">Download</button>
            <div class="screenshot-container" id="screenshot-container"></div>
        </div>

        <div class="card">
            <h2>WiFi Configuration</h2>
            <div id="wifi-status" style="margin-bottom: 15px;"></div>
            <button class="btn btn-secondary" onclick="scanNetworks()">Scan Networks</button>
            <div id="network-list" class="network-list" style="display:none;"></div>
            <div class="form-group">
                <label>SSID</label>
                <input type="text" id="wifi-ssid" placeholder="Network name">
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="wifi-password" placeholder="Password (leave empty for open networks)">
            </div>
            <button class="btn" onclick="connectWifi()">Save & Connect</button>
        </div>

        <div class="card">
            <h2>Firmware Update</h2>
            <p style="margin-bottom: 15px; color: #888;">
                Upload new firmware via the OTA update interface.
            </p>
            <a href="/update" class="btn">Open OTA Update</a>
        </div>

        <div class="card">
            <h2>System</h2>
            <button class="btn btn-danger" onclick="restartDevice()">Restart Device</button>
        </div>
    </div>

    <script>
        async function loadDeviceInfo() {
            try {
                const response = await fetch('/api/info');
                const data = await response.json();

                const grid = document.getElementById('device-info');
                let scheduleHtml = '';
                if (data.schedule_enabled) {
                    const periodInfo = data.current_period ?
                        `<span style="color: #4a4;">● ${data.current_period}</span> (${data.scheduled_brightness}%)` :
                        'No active period';
                    scheduleHtml = `
                    <div class="info-item">
                        <div class="info-label">Device Time</div>
                        <div class="info-value">${data.time_synced ? data.current_time : '<span style="color: #f0ad4e;">Syncing...</span>'}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Schedule Period</div>
                        <div class="info-value">${periodInfo}</div>
                    </div>`;
                }
                grid.innerHTML = `
                    <div class="info-item">
                        <div class="info-label">Chip</div>
                        <div class="info-value">${data.chip_model} Rev ${data.chip_revision}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">CPU Frequency</div>
                        <div class="info-value">${data.cpu_freq_mhz} MHz</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Free Heap</div>
                        <div class="info-value">${(data.free_heap / 1024).toFixed(1)} KB</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">PSRAM</div>
                        <div class="info-value">${(data.free_psram / 1024 / 1024).toFixed(1)} / ${(data.total_psram / 1024 / 1024).toFixed(1)} MB</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Uptime</div>
                        <div class="info-value">${formatUptime(data.uptime_seconds)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">IP Address</div>
                        <div class="info-value">${data.ip_address}</div>
                    </div>
                    ${scheduleHtml}
                    <div class="info-item">
                        <div class="info-label">Brightness</div>
                        <div class="info-value">${data.current_brightness}%${data.schedule_enabled ? ' <span style="color: #888; font-size: 0.8em;">(scheduled)</span>' : ''}</div>
                    </div>
                    <div class="info-item" style="grid-column: span 2;">
                        <div class="info-label">Reporting URL</div>
                        <div class="info-value" style="font-size: 0.9em; word-break: break-all;">${data.reporting_url || 'Not configured'}</div>
                    </div>
                `;
            } catch (e) {
                console.error('Failed to load device info:', e);
            }
        }

        function formatUptime(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return `${h}h ${m}m ${s}s`;
        }

        async function captureScreenshot() {
            try {
                const response = await fetch('/api/screenshot/capture', { method: 'POST' });
                const data = await response.json();

                const status = document.getElementById('screenshot-status');
                if (data.success) {
                    status.innerHTML = `<span class="status status-success">Screenshot captured (${(data.size / 1024).toFixed(1)} KB)</span>`;
                    viewScreenshot();
                } else {
                    status.innerHTML = `<span class="status status-error">${data.message}</span>`;
                }
            } catch (e) {
                console.error('Failed to capture screenshot:', e);
            }
        }

        function viewScreenshot() {
            const container = document.getElementById('screenshot-container');
            container.innerHTML = `<img src="/api/screenshot/view?t=${Date.now()}" alt="Screenshot" onerror="this.parentElement.innerHTML='<p style=\\'color:#888\\'>No screenshot available</p>'">`;
        }

        function downloadScreenshot() {
            window.location.href = '/api/screenshot/download';
        }

        async function restartDevice() {
            if (confirm('Are you sure you want to restart the device?')) {
                await fetch('/api/restart', { method: 'POST' });
                alert('Device is restarting...');
            }
        }

        async function loadWifiStatus() {
            try {
                const response = await fetch('/api/wifi/status');
                const data = await response.json();

                const status = document.getElementById('wifi-status');
                if (data.connected) {
                    status.innerHTML = `<span class="status status-success">Connected to ${data.ssid} (${data.rssi} dBm)</span>`;
                } else if (data.mode === 'ap') {
                    status.innerHTML = `<span class="status status-error">AP Mode: Connect to "${data.ap_ssid}" to configure</span>`;
                } else {
                    status.innerHTML = `<span class="status status-error">Disconnected</span>`;
                }
            } catch (e) {
                console.error('Failed to load WiFi status:', e);
            }
        }

        async function scanNetworks() {
            const list = document.getElementById('network-list');
            list.style.display = 'block';
            list.innerHTML = '<div style="padding: 10px; color: #888;">Scanning...</div>';

            try {
                const response = await fetch('/api/wifi/scan');
                const data = await response.json();

                if (data.networks.length === 0) {
                    list.innerHTML = '<div style="padding: 10px; color: #888;">No networks found</div>';
                    return;
                }

                list.innerHTML = data.networks.map(net =>
                    `<div class="network-item" onclick="selectNetwork('${net.ssid}')">
                        <span>${net.ssid} ${net.secure ? '🔒' : ''}</span>
                        <span class="signal">${net.rssi} dBm</span>
                    </div>`
                ).join('');
            } catch (e) {
                list.innerHTML = '<div style="padding: 10px; color: #ea868f;">Scan failed</div>';
            }
        }

        function selectNetwork(ssid) {
            document.getElementById('wifi-ssid').value = ssid;
            document.getElementById('network-list').style.display = 'none';
            document.getElementById('wifi-password').focus();
        }

        async function connectWifi() {
            const ssid = document.getElementById('wifi-ssid').value;
            const password = document.getElementById('wifi-password').value;

            if (!ssid) {
                alert('Please enter an SSID');
                return;
            }

            try {
                const response = await fetch('/api/wifi/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ssid, password })
                });
                const data = await response.json();

                if (data.success) {
                    alert('WiFi credentials saved. Device will restart and connect to the new network.');
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                console.error('Failed to save WiFi:', e);
            }
        }

        async function loadReportingUrl() {
            try {
                const response = await fetch('/api/server');
                const data = await response.json();
                document.getElementById('reporting-url-input').value = data.reportingUrl || '';
            } catch (e) {
                console.error('Failed to load reporting URL:', e);
            }
        }

        async function saveReportingUrl() {
            const url = document.getElementById('reporting-url-input').value.trim();
            const status = document.getElementById('reporting-url-status');

            if (!url) {
                status.innerHTML = '<span class="status status-error">URL is required</span>';
                return;
            }

            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                status.innerHTML = '<span class="status status-error">URL must start with http:// or https://</span>';
                return;
            }

            try {
                const response = await fetch('/api/server', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reportingUrl: url })
                });
                const data = await response.json();

                if (response.status === 200) {
                    status.innerHTML = '<span class="status status-success">' + data.message + '</span>';
                } else if (response.status === 202) {
                    status.innerHTML = '<span class="status" style="background: #5c4b00; color: #ffc107;">Confirm on device display</span>';
                } else {
                    status.innerHTML = '<span class="status status-error">' + (data.error || 'Failed') + '</span>';
                }
            } catch (e) {
                status.innerHTML = '<span class="status status-error">Connection error</span>';
            }
        }

        // Load data on page load
        loadDeviceInfo();
        loadWifiStatus();
        loadReportingUrl();
        setInterval(loadDeviceInfo, 5000);
        setInterval(loadWifiStatus, 10000);

        // Check for existing screenshot
        fetch('/api/screenshot/status')
            .then(r => r.json())
            .then(data => {
                if (data.available) {
                    document.getElementById('screenshot-status').innerHTML =
                        `<span class="status status-success">Screenshot available (${(data.size / 1024).toFixed(1)} KB)</span>`;
                    viewScreenshot();
                }
            });
    </script>
</body>
</html>
)rawliteral";
}
