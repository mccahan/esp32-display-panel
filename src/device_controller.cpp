#include "device_controller.h"
#include "ui_manager.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Global instance
DeviceController deviceController;

// HTTP worker task - processes requests from queue one at a time
void DeviceController::httpWorkerTask(void* parameter) {
    DeviceController* controller = (DeviceController*)parameter;
    HttpRequest request;

    while (true) {
        // Wait for a request (blocks until available)
        if (xQueueReceive(controller->httpQueue, &request, portMAX_DELAY) == pdTRUE) {
            // Check WiFi before attempting connection
            if (WiFi.status() != WL_CONNECTED) {
                Serial.println("DeviceController: WiFi not connected, dropping request");
                continue;
            }

            HTTPClient http;
            http.begin(request.url);
            http.addHeader("Content-Type", "application/json");
            http.setTimeout(3000);  // 3 second timeout
            http.setReuse(false);   // Don't reuse connections (cleaner socket management)

            int httpCode = http.POST(request.payload);

            if (httpCode > 0) {
                Serial.printf("DeviceController: POST %s -> %d\n", request.url, httpCode);
            } else {
                Serial.printf("DeviceController: POST failed: %d (%s)\n",
                    httpCode, http.errorToString(httpCode).c_str());
            }

            http.end();

            // Small delay between requests to let sockets fully close
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }
}

DeviceController::DeviceController()
    : serverConnected(false)
    , lastServerCheck(0)
    , lastWebhookTime(0)
    , httpQueue(nullptr)
    , httpWorkerHandle(nullptr)
{
}

void DeviceController::begin() {
    Serial.println("DeviceController: Initializing...");

    // Create HTTP request queue (small queue - we only care about latest state)
    httpQueue = xQueueCreate(HTTP_QUEUE_SIZE, sizeof(HttpRequest));
    if (httpQueue == nullptr) {
        Serial.println("DeviceController: Failed to create HTTP queue!");
    }

    // Create single HTTP worker task
    xTaskCreatePinnedToCore(
        httpWorkerTask,
        "HTTPWorker",
        4096,
        this,
        1,  // Low priority
        &httpWorkerHandle,
        1   // Run on core 1 (leave core 0 for WiFi)
    );

    // Register callbacks with UI manager
    uiManager.setButtonCallback([](uint8_t buttonId, bool newState) {
        deviceController.onButtonStateChanged(buttonId, newState);
    });

    uiManager.setSceneCallback([](uint8_t sceneId) {
        deviceController.onSceneActivated(sceneId);
    });

    Serial.println("DeviceController: Initialized with HTTP worker task");
}

void DeviceController::onButtonStateChanged(uint8_t buttonId, bool newState) {
    const DeviceConfig& config = configManager.getConfig();

    // Find the button to check its type
    for (const ButtonConfig& btn : config.buttons) {
        if (btn.id == buttonId) {
            // Scene buttons don't have state, just trigger the scene
            if (btn.type == ButtonType::SCENE) {
                Serial.printf("DeviceController: Scene button %d pressed\n", buttonId);
                sendButtonWebhook(buttonId, true);  // Send press event to server
                return;
            }
            break;
        }
    }

    Serial.printf("DeviceController: Button %d changed to %s\n", buttonId, newState ? "ON" : "OFF");

    // Update config for non-scene buttons
    configManager.setButtonState(buttonId, newState);

    // Send webhook to server (non-blocking would be better, but keep it simple)
    sendButtonWebhook(buttonId, newState);
}

void DeviceController::onSceneActivated(uint8_t sceneId) {
    Serial.printf("DeviceController: Scene %d activated\n", sceneId);

    const DeviceConfig& config = configManager.getConfig();

    // Find the scene
    for (const SceneConfig& scene : config.scenes) {
        if (scene.id == sceneId) {
            // Handle built-in scene actions
            if (scene.name == "All Off") {
                setAllButtons(false);
            } else if (scene.name == "All On") {
                setAllButtons(true);
            }
            break;
        }
    }

    // Send webhook to server
    sendSceneWebhook(sceneId);
}

void DeviceController::setAllButtons(bool state) {
    const DeviceConfig& config = configManager.getConfig();

    for (const ButtonConfig& btn : config.buttons) {
        configManager.setButtonState(btn.id, state);
        uiManager.updateButtonState(btn.id, state);
    }

    Serial.printf("DeviceController: All buttons set to %s\n", state ? "ON" : "OFF");
}

void DeviceController::httpPostAsync(const String& url, const String& payload) {
    if (httpQueue == nullptr) {
        Serial.println("DeviceController: HTTP queue not initialized");
        return;
    }

    // Prepare request
    HttpRequest request;
    strncpy(request.url, url.c_str(), sizeof(request.url) - 1);
    request.url[sizeof(request.url) - 1] = '\0';
    strncpy(request.payload, payload.c_str(), sizeof(request.payload) - 1);
    request.payload[sizeof(request.payload) - 1] = '\0';

    // Try to add to queue (don't block if full - just drop the request)
    // The state sync service will catch up with correct state anyway
    if (xQueueSend(httpQueue, &request, 0) != pdTRUE) {
        Serial.println("DeviceController: HTTP queue full, dropping request");
    }
}

void DeviceController::sendButtonWebhook(uint8_t buttonId, bool state) {
    // Rate limiting
    unsigned long now = millis();
    if (now - lastWebhookTime < WEBHOOK_MIN_INTERVAL) {
        return;
    }
    lastWebhookTime = now;

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("DeviceController: WiFi not connected, skipping webhook");
        return;
    }

    const DeviceConfig& config = configManager.getConfig();
    String url = config.server.reportingUrl + "/api/action/light/" + String(buttonId);

    // Create payload
    StaticJsonDocument<256> doc;
    doc["deviceId"] = config.device.id;
    doc["buttonId"] = buttonId;
    doc["state"] = state;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    // Use async POST so UI isn't blocked
    httpPostAsync(url, payload);
}

void DeviceController::sendSceneWebhook(uint8_t sceneId) {
    // Rate limiting
    unsigned long now = millis();
    if (now - lastWebhookTime < WEBHOOK_MIN_INTERVAL) {
        return;
    }
    lastWebhookTime = now;

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("DeviceController: WiFi not connected, skipping webhook");
        return;
    }

    const DeviceConfig& config = configManager.getConfig();
    String url = config.server.reportingUrl + "/api/action/scene/" + String(sceneId);

    // Create payload
    StaticJsonDocument<256> doc;
    doc["deviceId"] = config.device.id;
    doc["sceneId"] = sceneId;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    // Use async POST so UI isn't blocked
    httpPostAsync(url, payload);
}

bool DeviceController::httpPost(const String& url, const String& payload) {
    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(2000);  // 2 second timeout

    int httpCode = http.POST(payload);
    http.end();

    if (httpCode > 0) {
        Serial.printf("DeviceController: POST %s -> %d\n", url.c_str(), httpCode);
        return httpCode >= 200 && httpCode < 300;
    } else {
        Serial.printf("DeviceController: POST failed: %s\n", http.errorToString(httpCode).c_str());
        return false;
    }
}

void DeviceController::reportStateToServer() {
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    const DeviceConfig& config = configManager.getConfig();
    String url = config.server.reportingUrl + "/api/devices/" + config.device.id + "/state";

    String payload = getStateJson();
    httpPost(url, payload);
}

void DeviceController::processServerStateUpdate(const String& json) {
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("DeviceController: Failed to parse state update: %s\n", error.c_str());
        return;
    }

    // Update button states
    JsonArray buttons = doc["buttons"];
    for (JsonObject btn : buttons) {
        uint8_t id = btn["id"];
        bool state = btn["state"];

        // Check if speedLevel is present (for fans)
        if (btn.containsKey("speedLevel")) {
            uint8_t speedLevel = btn["speedLevel"];
            uiManager.setFanSpeed(id, speedLevel);
            configManager.setButtonState(id, speedLevel > 0);
        } else {
            configManager.setButtonState(id, state);
            uiManager.updateButtonState(id, state);
        }
    }

    // Update display settings if present
    if (doc.containsKey("brightness")) {
        uint8_t brightness = doc["brightness"];
        uiManager.setBrightness(brightness);
        configManager.getConfigMutable().display.brightness = brightness;
    }

    Serial.println("DeviceController: State update processed");
}

String DeviceController::getStateJson() {
    const DeviceConfig& config = configManager.getConfig();

    DynamicJsonDocument doc(1024);

    doc["deviceId"] = config.device.id;
    doc["name"] = config.device.name;
    doc["location"] = config.device.location;
    doc["ip"] = WiFi.localIP().toString();
    doc["mac"] = WiFi.macAddress();
    doc["uptime"] = millis() / 1000;
    doc["brightness"] = uiManager.getBrightness();
    doc["theme"] = config.display.theme;

    // Button states
    JsonArray buttons = doc.createNestedArray("buttons");
    for (const ButtonConfig& btn : config.buttons) {
        JsonObject b = buttons.createNestedObject();
        b["id"] = btn.id;
        b["name"] = btn.name;
        b["type"] = (btn.type == ButtonType::SWITCH) ? "switch" : "light";
        b["state"] = btn.state;
    }

    // Scene info
    JsonArray scenes = doc.createNestedArray("scenes");
    for (const SceneConfig& scn : config.scenes) {
        JsonObject s = scenes.createNestedObject();
        s["id"] = scn.id;
        s["name"] = scn.name;
    }

    String result;
    serializeJson(doc, result);
    return result;
}

bool DeviceController::isServerConnected() {
    return serverConnected;
}

void DeviceController::update() {
    // Periodic server connectivity check
    unsigned long now = millis();
    if (now - lastServerCheck >= SERVER_CHECK_INTERVAL) {
        lastServerCheck = now;

        if (WiFi.status() == WL_CONNECTED) {
            const DeviceConfig& config = configManager.getConfig();
            String url = config.server.reportingUrl + "/api/ping";

            HTTPClient http;
            http.begin(url);
            http.setTimeout(2000);

            int httpCode = http.GET();
            http.end();

            bool wasConnected = serverConnected;
            serverConnected = (httpCode == 200);

            if (serverConnected != wasConnected) {
                Serial.printf("DeviceController: Server %s\n", serverConnected ? "connected" : "disconnected");
            }
        } else {
            serverConnected = false;
        }
    }
}
