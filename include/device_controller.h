#ifndef DEVICE_CONTROLLER_H
#define DEVICE_CONTROLLER_H

#include <Arduino.h>
#include "config_manager.h"

class DeviceController {
public:
    DeviceController();

    // Initialize device controller
    void begin();

    // Handle button state change (called from UI)
    void onButtonStateChanged(uint8_t buttonId, bool newState);

    // Handle scene activation (called from UI)
    void onSceneActivated(uint8_t sceneId);

    // Set all buttons to a specific state
    void setAllButtons(bool state);

    // Send state update to server
    void reportStateToServer();

    // Process incoming state update from server
    void processServerStateUpdate(const String& json);

    // Get device state as JSON for API
    String getStateJson();

    // Check if server is reachable
    bool isServerConnected();

    // Periodic tasks (call from main loop)
    void update();

private:
    // Send webhook for button action
    void sendButtonWebhook(uint8_t buttonId, bool state);

    // Send webhook for scene action
    void sendSceneWebhook(uint8_t sceneId);

    // HTTP POST helper
    bool httpPost(const String& url, const String& payload);

    // Track server connectivity
    bool serverConnected;
    unsigned long lastServerCheck;
    static const unsigned long SERVER_CHECK_INTERVAL = 30000;  // 30 seconds

    // Rate limiting for webhooks
    unsigned long lastWebhookTime;
    static const unsigned long WEBHOOK_MIN_INTERVAL = 100;  // 100ms between webhooks
};

// Global instance
extern DeviceController deviceController;

#endif // DEVICE_CONTROLLER_H
