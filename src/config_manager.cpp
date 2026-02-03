#include "config_manager.h"
#include <Preferences.h>
#include <WiFi.h>
#include <HTTPClient.h>

// NVS keys
const char* ConfigManager::NVS_NAMESPACE = "device_config";
const char* ConfigManager::NVS_CONFIG_KEY = "config_json";

// Global instance
ConfigManager configManager;

ConfigManager::ConfigManager() : configured(false) {
}

void ConfigManager::begin() {
    Serial.println("ConfigManager: Initializing...");

    // Try to load saved configuration
    if (!loadConfig()) {
        Serial.println("ConfigManager: No saved config, using defaults");
        createDefaultConfig();
    }

    Serial.printf("ConfigManager: Device ID: %s\n", config.device.id.c_str());
    Serial.printf("ConfigManager: Theme: %s\n", config.display.theme.c_str());
    Serial.printf("ConfigManager: Buttons: %d, Scenes: %d\n",
                  config.buttons.size(), config.scenes.size());
}

bool ConfigManager::loadConfig() {
    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, true)) {
        Serial.println("ConfigManager: Failed to open NVS");
        return false;
    }

    String json = prefs.getString(NVS_CONFIG_KEY, "");
    prefs.end();

    if (json.length() == 0) {
        Serial.println("ConfigManager: No config in NVS");
        return false;
    }

    Serial.println("ConfigManager: Loading config from NVS...");
    return parseConfigJson(json);
}

bool ConfigManager::saveConfig() {
    String json = toJson();
    if (json.length() == 0) {
        Serial.println("ConfigManager: Failed to serialize config");
        return false;
    }

    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, false)) {
        Serial.println("ConfigManager: Failed to open NVS for writing");
        return false;
    }

    bool success = prefs.putString(NVS_CONFIG_KEY, json);
    prefs.end();

    if (success) {
        Serial.println("ConfigManager: Config saved to NVS");
    } else {
        Serial.println("ConfigManager: Failed to save config to NVS");
    }

    return success;
}

bool ConfigManager::parseConfigJson(const String& json) {
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("ConfigManager: JSON parse error: %s\n", error.c_str());
        return false;
    }

    // Parse version
    config.version = doc["version"] | 1;

    // Parse device info
    JsonObject device = doc["device"];
    config.device.id = device["id"] | generateDeviceId();
    config.device.name = device["name"] | "ESP32 Display";
    config.device.location = device["location"] | "Unknown";

    // Parse display settings
    JsonObject display = doc["display"];
    config.display.brightness = display["brightness"] | 80;
    config.display.theme = display["theme"] | "dark_clean";

    // Parse day/night mode
    JsonObject dayNight = display["dayNightMode"];
    config.display.dayNight.enabled = dayNight["enabled"] | false;
    config.display.dayNight.dayTheme = dayNight["dayTheme"] | "light_mode";
    config.display.dayNight.nightTheme = dayNight["nightTheme"] | "dark_clean";
    config.display.dayNight.dayStartHour = dayNight["dayStartHour"] | 7;
    config.display.dayNight.nightStartHour = dayNight["nightStartHour"] | 20;

    // Parse LCARS configuration
    JsonObject lcars = display["lcars"];
    config.display.lcars.enabled = lcars["enabled"] | false;
    config.display.lcars.colorScheme = lcars["colorScheme"] | "federation";
    config.display.lcars.headerLeft = lcars["headerLeft"] | "STARDATE";
    config.display.lcars.headerRight = lcars["headerRight"] | "ONLINE";
    config.display.lcars.footerLeft = lcars["footerLeft"] | "";
    config.display.lcars.footerRight = lcars["footerRight"] | "";
    config.display.lcars.sidebarTop = lcars["sidebarTop"] | "";
    config.display.lcars.sidebarBottom = lcars["sidebarBottom"] | "";

    // Parse LCARS custom fields
    config.display.lcars.customFields.clear();
    JsonArray customFields = lcars["customFields"];
    for (JsonObject field : customFields) {
        LCARSTextField textField;
        textField.id = field["id"] | "";
        textField.value = field["value"] | "";
        textField.style = field["style"] | "label";
        config.display.lcars.customFields.push_back(textField);
    }

    // Parse buttons
    config.buttons.clear();
    JsonArray buttons = doc["buttons"];
    for (JsonObject btn : buttons) {
        if (config.buttons.size() >= MAX_BUTTONS) break;

        ButtonConfig button;
        button.id = btn["id"] | (config.buttons.size() + 1);
        String typeStr = btn["type"] | "light";
        if (typeStr == "switch") {
            button.type = ButtonType::SWITCH;
        } else if (typeStr == "fan") {
            button.type = ButtonType::FAN;
        } else if (typeStr == "scene") {
            button.type = ButtonType::SCENE;
        } else {
            button.type = ButtonType::LIGHT;
        }
        button.name = btn["name"] | "Button";
        button.icon = btn["icon"] | "charge";
        button.state = btn["state"] | false;
        button.subtitle = btn["subtitle"] | "";
        button.speedSteps = btn["speedSteps"] | 0;  // 0 = simple on/off, 3 = low/med/high
        button.speedLevel = btn["speedLevel"] | 0;
        button.sceneId = btn["sceneId"] | "";  // Scene ID for scene-type buttons
        config.buttons.push_back(button);
    }

    // Parse scenes
    config.scenes.clear();
    JsonArray scenes = doc["scenes"];
    for (JsonObject scn : scenes) {
        if (config.scenes.size() >= MAX_SCENES) break;

        SceneConfig scene;
        scene.id = scn["id"] | (config.scenes.size() + 1);
        scene.name = scn["name"] | "Scene";
        scene.icon = scn["icon"] | "power";
        config.scenes.push_back(scene);
    }

    // Parse server config
    JsonObject server = doc["server"];
    config.server.host = server["host"] | "10.0.1.250";
    config.server.port = server["port"] | 3000;
    config.server.reportingUrl = server["reportingUrl"] | "";

    // If no reporting URL, construct from host/port for backwards compatibility
    if (config.server.reportingUrl.length() == 0) {
        config.server.reportingUrl = "http://" + config.server.host + ":" + String(config.server.port);
    }

    configured = true;
    Serial.println("ConfigManager: Config parsed successfully");
    return true;
}

String ConfigManager::toJson() {
    DynamicJsonDocument doc(4096);

    doc["version"] = config.version;

    // Device info
    JsonObject device = doc.createNestedObject("device");
    device["id"] = config.device.id;
    device["name"] = config.device.name;
    device["location"] = config.device.location;

    // Display settings
    JsonObject display = doc.createNestedObject("display");
    display["brightness"] = config.display.brightness;
    display["theme"] = config.display.theme;

    JsonObject dayNight = display.createNestedObject("dayNightMode");
    dayNight["enabled"] = config.display.dayNight.enabled;
    dayNight["dayTheme"] = config.display.dayNight.dayTheme;
    dayNight["nightTheme"] = config.display.dayNight.nightTheme;
    dayNight["dayStartHour"] = config.display.dayNight.dayStartHour;
    dayNight["nightStartHour"] = config.display.dayNight.nightStartHour;

    // LCARS configuration
    JsonObject lcars = display.createNestedObject("lcars");
    lcars["enabled"] = config.display.lcars.enabled;
    lcars["colorScheme"] = config.display.lcars.colorScheme;
    lcars["headerLeft"] = config.display.lcars.headerLeft;
    lcars["headerRight"] = config.display.lcars.headerRight;
    lcars["footerLeft"] = config.display.lcars.footerLeft;
    lcars["footerRight"] = config.display.lcars.footerRight;
    lcars["sidebarTop"] = config.display.lcars.sidebarTop;
    lcars["sidebarBottom"] = config.display.lcars.sidebarBottom;

    JsonArray customFields = lcars.createNestedArray("customFields");
    for (const LCARSTextField& field : config.display.lcars.customFields) {
        JsonObject f = customFields.createNestedObject();
        f["id"] = field.id;
        f["value"] = field.value;
        f["style"] = field.style;
    }

    // Buttons
    JsonArray buttons = doc.createNestedArray("buttons");
    for (const ButtonConfig& btn : config.buttons) {
        JsonObject button = buttons.createNestedObject();
        button["id"] = btn.id;
        const char* typeStr = "light";
        if (btn.type == ButtonType::SWITCH) typeStr = "switch";
        else if (btn.type == ButtonType::FAN) typeStr = "fan";
        else if (btn.type == ButtonType::SCENE) typeStr = "scene";
        button["type"] = typeStr;
        button["name"] = btn.name;
        button["icon"] = btn.icon;
        button["state"] = btn.state;
        if (btn.subtitle.length() > 0) {
            button["subtitle"] = btn.subtitle;
        }
        if (btn.type == ButtonType::FAN) {
            button["speedSteps"] = btn.speedSteps;
            button["speedLevel"] = btn.speedLevel;
        }
        if (btn.type == ButtonType::SCENE && btn.sceneId.length() > 0) {
            button["sceneId"] = btn.sceneId;
        }
    }

    // Scenes
    JsonArray scenes = doc.createNestedArray("scenes");
    for (const SceneConfig& scn : config.scenes) {
        JsonObject scene = scenes.createNestedObject();
        scene["id"] = scn.id;
        scene["name"] = scn.name;
        scene["icon"] = scn.icon;
    }

    // Server config
    JsonObject server = doc.createNestedObject("server");
    server["host"] = config.server.host;
    server["port"] = config.server.port;
    server["reportingUrl"] = config.server.reportingUrl;

    String json;
    serializeJson(doc, json);
    return json;
}

bool ConfigManager::fetchConfigFromServer() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("ConfigManager: WiFi not connected, cannot fetch config");
        return false;
    }

    // Preserve current reporting URL - this is set locally and shouldn't be overwritten by server
    String savedReportingUrl = config.server.reportingUrl;

    String url = savedReportingUrl + "/api/devices/" + getDeviceId() + "/config";

    Serial.printf("ConfigManager: Fetching config from %s\n", url.c_str());

    HTTPClient http;
    http.begin(url);
    http.setTimeout(5000);

    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        http.end();

        if (parseConfigJson(payload)) {
            // Restore the reporting URL - device's local setting takes precedence over server
            config.server.reportingUrl = savedReportingUrl;
            saveConfig();
            return true;
        }
    } else if (httpCode == HTTP_CODE_NOT_FOUND) {
        Serial.println("ConfigManager: Device not registered with server (404)");
    } else {
        Serial.printf("ConfigManager: HTTP error: %d\n", httpCode);
    }

    http.end();
    return false;
}

const DeviceConfig& ConfigManager::getConfig() const {
    return config;
}

DeviceConfig& ConfigManager::getConfigMutable() {
    return config;
}

void ConfigManager::setServerAddress(const String& host, uint16_t port) {
    config.server.host = host;
    config.server.port = port;
    config.server.reportingUrl = "http://" + host + ":" + String(port);
}

void ConfigManager::setReportingUrl(const String& url) {
    config.server.reportingUrl = url;
}

String ConfigManager::getDeviceId() {
    if (config.device.id.length() > 0) {
        return config.device.id;
    }
    return generateDeviceId();
}

bool ConfigManager::isConfigured() const {
    return configured;
}

void ConfigManager::resetToDefaults() {
    // Clear NVS
    Preferences prefs;
    if (prefs.begin(NVS_NAMESPACE, false)) {
        prefs.clear();
        prefs.end();
    }

    createDefaultConfig();
    configured = false;
}

void ConfigManager::setButtonState(uint8_t buttonId, bool state) {
    for (ButtonConfig& btn : config.buttons) {
        if (btn.id == buttonId) {
            btn.state = state;
            return;
        }
    }
}

bool ConfigManager::getButtonState(uint8_t buttonId) {
    for (const ButtonConfig& btn : config.buttons) {
        if (btn.id == buttonId) {
            return btn.state;
        }
    }
    return false;
}

String ConfigManager::generateDeviceId() {
    String mac = WiFi.macAddress();
    mac.replace(":", "");
    mac.toLowerCase();
    return "esp32-" + mac.substring(6);  // Last 6 chars of MAC
}

void ConfigManager::createDefaultConfig() {
    config.version = 1;

    // Device info
    config.device.id = generateDeviceId();
    config.device.name = "ESP32 Display";
    config.device.location = "Unknown";

    // Display settings
    config.display.brightness = 80;
    config.display.theme = "dark_clean";
    config.display.dayNight.enabled = false;
    config.display.dayNight.dayTheme = "light_mode";
    config.display.dayNight.nightTheme = "dark_clean";
    config.display.dayNight.dayStartHour = 7;
    config.display.dayNight.nightStartHour = 20;

    // LCARS defaults (disabled by default)
    config.display.lcars.enabled = false;
    config.display.lcars.colorScheme = "federation";
    config.display.lcars.headerLeft = "STARDATE";
    config.display.lcars.headerRight = "ONLINE";
    config.display.lcars.footerLeft = "";
    config.display.lcars.footerRight = "";
    config.display.lcars.sidebarTop = "";
    config.display.lcars.sidebarBottom = "";
    config.display.lcars.customFields.clear();

    // Default buttons (4 lights)
    config.buttons.clear();
    const char* defaultNames[] = {"Living Room", "Bedroom", "Kitchen", "Bathroom"};
    for (int i = 0; i < 4; i++) {
        ButtonConfig btn;
        btn.id = i + 1;
        btn.type = ButtonType::LIGHT;
        btn.name = defaultNames[i];
        btn.icon = "charge";
        btn.state = false;
        config.buttons.push_back(btn);
    }

    // Default scenes
    config.scenes.clear();
    SceneConfig sceneOff;
    sceneOff.id = 1;
    sceneOff.name = "All Off";
    sceneOff.icon = "power";
    config.scenes.push_back(sceneOff);

    SceneConfig sceneOn;
    sceneOn.id = 2;
    sceneOn.name = "All On";
    sceneOn.icon = "ok";
    config.scenes.push_back(sceneOn);

    // Server config
    config.server.host = "10.0.1.250";
    config.server.port = 3000;
    config.server.reportingUrl = "http://10.0.1.250:3000";

    Serial.println("ConfigManager: Created default configuration");
}
