#include "time_manager.h"
#include <WiFi.h>
#include <time.h>

// NTP servers
const char* TimeManager::NTP_SERVER1 = "pool.ntp.org";
const char* TimeManager::NTP_SERVER2 = "time.nist.gov";
const char* TimeManager::NTP_SERVER3 = "time.google.com";

// Global instance
TimeManager timeManager;

TimeManager::TimeManager()
    : currentTimezone("MST7MDT,M3.2.0,M11.1.0")
    , synced(false)
    , lastSyncAttempt(0)
    , lastSuccessfulSync(0) {
}

void TimeManager::begin() {
    Serial.println("TimeManager: Initializing...");

    // Set default timezone
    setenv("TZ", currentTimezone.c_str(), 1);
    tzset();

    // Configure NTP
    configTime(0, 0, NTP_SERVER1, NTP_SERVER2, NTP_SERVER3);

    Serial.printf("TimeManager: Timezone set to %s\n", currentTimezone.c_str());
}

void TimeManager::setTimezone(const String& posixTimezone) {
    if (posixTimezone.length() == 0) {
        Serial.println("TimeManager: Empty timezone, keeping current");
        return;
    }

    if (posixTimezone != currentTimezone) {
        currentTimezone = posixTimezone;
        setenv("TZ", currentTimezone.c_str(), 1);
        tzset();
        Serial.printf("TimeManager: Timezone updated to %s\n", currentTimezone.c_str());
    }
}

bool TimeManager::isSynced() const {
    return synced;
}

uint8_t TimeManager::getCurrentHour() const {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        return 0;
    }
    return timeinfo.tm_hour;
}

uint8_t TimeManager::getCurrentMinute() const {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        return 0;
    }
    return timeinfo.tm_min;
}

void TimeManager::update() {
    unsigned long now = millis();

    // Check if we need to attempt sync
    if (!synced) {
        // Not synced - retry more frequently
        if (now - lastSyncAttempt >= SYNC_RETRY_MS) {
            attemptSync();
        }
    } else {
        // Synced - periodic re-sync
        if (now - lastSuccessfulSync >= SYNC_INTERVAL_MS) {
            attemptSync();
        }
    }
}

void TimeManager::forceSync() {
    Serial.println("TimeManager: Forcing NTP sync...");
    attemptSync();
}

void TimeManager::attemptSync() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("TimeManager: WiFi not connected, skipping sync");
        return;
    }

    lastSyncAttempt = millis();

    // Check if time is valid
    if (checkSyncStatus()) {
        if (!synced) {
            Serial.println("TimeManager: NTP sync successful");

            // Print current time
            struct tm timeinfo;
            if (getLocalTime(&timeinfo)) {
                Serial.printf("TimeManager: Current time: %02d:%02d:%02d\n",
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
            }
        }
        synced = true;
        lastSuccessfulSync = millis();
    } else {
        Serial.println("TimeManager: NTP sync pending...");
    }
}

bool TimeManager::checkSyncStatus() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo, 1000)) {  // 1 second timeout
        return false;
    }

    // Check if year is reasonable (after 2024)
    return (timeinfo.tm_year + 1900) >= 2024;
}
