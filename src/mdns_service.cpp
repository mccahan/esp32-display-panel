#include "mdns_service.h"
#include "config_manager.h"
#include <ESPmDNS.h>
#include <WiFi.h>

// Global instance
MDNSService mdnsService;

// Service constants
const char* MDNSService::SERVICE_TYPE = "esp32display";
const char* MDNSService::SERVICE_PROTOCOL = "tcp";

MDNSService::MDNSService()
    : running(false)
    , hostname("")
{
}

bool MDNSService::begin(const String& deviceHostname) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("mDNS: WiFi not connected, cannot start mDNS");
        return false;
    }

    // Use provided hostname or generate from device ID
    if (deviceHostname.length() > 0) {
        hostname = deviceHostname;
    } else {
        hostname = configManager.getDeviceId();
    }

    // Replace any invalid characters for hostname
    hostname.replace("_", "-");
    hostname.replace(".", "-");

    Serial.printf("mDNS: Starting with hostname '%s'\n", hostname.c_str());

    if (!MDNS.begin(hostname.c_str())) {
        Serial.println("mDNS: Failed to start mDNS responder");
        return false;
    }

    running = true;
    Serial.printf("mDNS: Responder started at %s.local\n", hostname.c_str());

    return true;
}

bool MDNSService::advertiseService() {
    if (!running) {
        Serial.println("mDNS: Cannot advertise - mDNS not running");
        return false;
    }

    // Add the service
    // Service type: _esp32display._tcp
    // This allows the Node.js server to discover devices using mDNS

    MDNS.addService(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_PORT);

    // Add TXT records with device information
    const DeviceConfig& config = configManager.getConfig();

    MDNS.addServiceTxt(SERVICE_TYPE, SERVICE_PROTOCOL, "id", config.device.id.c_str());
    MDNS.addServiceTxt(SERVICE_TYPE, SERVICE_PROTOCOL, "name", config.device.name.c_str());
    MDNS.addServiceTxt(SERVICE_TYPE, SERVICE_PROTOCOL, "mac", WiFi.macAddress().c_str());
    MDNS.addServiceTxt(SERVICE_TYPE, SERVICE_PROTOCOL, "version", "1");

    Serial.printf("mDNS: Advertising service _%s._%s on port %d\n",
                  SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_PORT);
    Serial.printf("mDNS: TXT records - id=%s, name=%s, mac=%s\n",
                  config.device.id.c_str(),
                  config.device.name.c_str(),
                  WiFi.macAddress().c_str());

    return true;
}

void MDNSService::stop() {
    if (running) {
        MDNS.end();
        running = false;
        Serial.println("mDNS: Service stopped");
    }
}

bool MDNSService::isRunning() const {
    return running;
}

String MDNSService::getHostname() const {
    return hostname;
}

String MDNSService::getFullHostname() const {
    return hostname + ".local";
}
