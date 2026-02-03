#ifndef TIME_MANAGER_H
#define TIME_MANAGER_H

#include <Arduino.h>

class TimeManager {
public:
    TimeManager();

    // Initialize NTP and set timezone
    void begin();

    // Update timezone from POSIX string (e.g., "MST7MDT,M3.2.0,M11.1.0")
    void setTimezone(const String& posixTimezone);

    // Check if time is synchronized with NTP
    bool isSynced() const;

    // Get current local time components
    uint8_t getCurrentHour() const;    // 0-23
    uint8_t getCurrentMinute() const;  // 0-59

    // Set time from server-provided Unix timestamp (faster than NTP)
    void setTimeFromServer(uint32_t unixTimestamp);

    // Update function - call periodically to re-sync NTP
    void update();

    // Force an NTP sync
    void forceSync();

private:
    String currentTimezone;
    bool synced;
    unsigned long lastSyncAttempt;
    unsigned long lastSuccessfulSync;

    static const unsigned long SYNC_INTERVAL_MS = 3600000;  // 1 hour
    static const unsigned long SYNC_RETRY_MS = 60000;       // 1 minute retry on failure
    static const char* NTP_SERVER1;
    static const char* NTP_SERVER2;
    static const char* NTP_SERVER3;

    void attemptSync();
    bool checkSyncStatus();
};

// Global instance
extern TimeManager timeManager;

#endif // TIME_MANAGER_H
