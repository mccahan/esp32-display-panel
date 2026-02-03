#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

// Maximum number of buttons and scenes
#define MAX_BUTTONS 6
#define MAX_SCENES 2

// Button types
enum class ButtonType {
    LIGHT,
    SWITCH,
    FAN,
    SCENE
};

// LCARS text field configuration
struct LCARSTextField {
    String id;          // Field identifier (e.g., "header_left", "header_right")
    String value;       // Display text
    String style;       // Style hint: "title", "label", "data", "status"
};

// LCARS-specific UI configuration
struct LCARSConfig {
    bool enabled;
    String colorScheme;      // "federation", "medical", "engineering", "tactical"
    String headerLeft;       // Top left text (e.g., "STARDATE")
    String headerRight;      // Top right text (e.g., system status)
    String footerLeft;       // Bottom left text
    String footerRight;      // Bottom right text
    String sidebarTop;       // Side panel top text
    String sidebarBottom;    // Side panel bottom text
    std::vector<LCARSTextField> customFields;  // Additional custom fields
};

// Button configuration
struct ButtonConfig {
    uint8_t id;
    ButtonType type;
    String name;
    String icon;
    bool state;
    String subtitle;    // Optional subtitle (e.g., for LCARS: "DECK 7")
    uint8_t speedSteps; // For fans: number of speed steps (0=on/off only, 3=off/low/med/high, etc.)
    uint8_t speedLevel; // Current speed level (0=off, 1-speedSteps for on states)
    String sceneId;     // For scene buttons: the scene ID to execute
};

// Scene configuration
struct SceneConfig {
    uint8_t id;
    String name;
    String icon;
};

// Day/Night mode configuration
struct DayNightConfig {
    bool enabled;
    String dayTheme;
    String nightTheme;
    uint8_t dayStartHour;
    uint8_t nightStartHour;
};

// Display configuration
struct DisplayConfig {
    uint8_t brightness;
    String theme;
    DayNightConfig dayNight;
    LCARSConfig lcars;       // LCARS-specific configuration
};

// Server configuration
struct ServerConfig {
    String reportingUrl; // Full URL for API calls (e.g., "http://192.168.1.100:8080")
};

// Device identification
struct DeviceInfo {
    String id;
    String name;
    String location;
};

// Complete device configuration
struct DeviceConfig {
    uint8_t version;
    DeviceInfo device;
    DisplayConfig display;
    std::vector<ButtonConfig> buttons;
    std::vector<SceneConfig> scenes;
    ServerConfig server;
};

class ConfigManager {
public:
    ConfigManager();

    // Initialize config manager and load from NVS
    void begin();

    // Load configuration from NVS
    bool loadConfig();

    // Save current configuration to NVS
    bool saveConfig();

    // Parse JSON configuration from server
    bool parseConfigJson(const String& json);

    // Serialize current config to JSON
    String toJson();

    // Fetch configuration from server (blocking)
    bool fetchConfigFromServer();

    // Get current configuration (read-only)
    const DeviceConfig& getConfig() const;

    // Get mutable configuration for updates
    DeviceConfig& getConfigMutable();

    // Set reporting URL
    void setReportingUrl(const String& url);

    // Get device ID (MAC-based if not configured)
    String getDeviceId();

    // Check if config has been loaded/set
    bool isConfigured() const;

    // Reset to default configuration
    void resetToDefaults();

    // Update a single button state
    void setButtonState(uint8_t buttonId, bool state);

    // Get button state
    bool getButtonState(uint8_t buttonId);

private:
    DeviceConfig config;
    bool configured;

    // Generate default device ID from MAC address
    String generateDeviceId();

    // Create default configuration
    void createDefaultConfig();

    // NVS namespace
    static const char* NVS_NAMESPACE;
    static const char* NVS_CONFIG_KEY;
};

// Global instance
extern ConfigManager configManager;

#endif // CONFIG_MANAGER_H
