#ifndef MDNS_SERVICE_H
#define MDNS_SERVICE_H

#include <Arduino.h>

class MDNSService {
public:
    MDNSService();

    // Initialize mDNS with device hostname
    bool begin(const String& hostname);

    // Advertise the ESP32 display service
    bool advertiseService();

    // Stop mDNS service
    void stop();

    // Check if mDNS is running
    bool isRunning() const;

    // Get the hostname
    String getHostname() const;

    // Get the full mDNS hostname (hostname.local)
    String getFullHostname() const;

private:
    bool running;
    String hostname;

    // Service type for discovery
    static const char* SERVICE_TYPE;
    static const char* SERVICE_PROTOCOL;
    static const uint16_t SERVICE_PORT = 80;
};

// Global instance
extern MDNSService mdnsService;

#endif // MDNS_SERVICE_H
