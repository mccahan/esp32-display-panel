#include "theme_scheduler.h"
#include "time_manager.h"
#include "theme_engine.h"
#include "ui_manager.h"

// Global instance
ThemeScheduler themeScheduler;

ThemeScheduler::ThemeScheduler()
    : currentAppliedTheme("")
    , wasNightTime(false)
    , initialized(false) {
}

void ThemeScheduler::begin() {
    Serial.println("ThemeScheduler: Initializing...");
    refresh();
}

bool ThemeScheduler::update() {
    const DayNightConfig& config = configManager.getConfig().display.dayNight;

    // Skip if day/night mode disabled
    if (!config.enabled) {
        return false;
    }

    // Skip if time not synced yet
    if (!timeManager.isSynced()) {
        return false;
    }

    uint8_t hour = timeManager.getCurrentHour();
    bool isDay = isDayTime(hour);
    bool isNight = !isDay;

    // Check if we crossed a day/night boundary
    if (initialized && isNight == wasNightTime) {
        // No change
        return false;
    }

    // Determine target theme
    const String& targetTheme = isDay ? config.dayTheme : config.nightTheme;

    // Check if theme actually needs to change
    if (targetTheme == currentAppliedTheme) {
        wasNightTime = isNight;
        initialized = true;
        return false;
    }

    Serial.printf("ThemeScheduler: Time boundary crossed at hour %d, switching to %s theme (%s)\n",
        hour, isDay ? "day" : "night", targetTheme.c_str());

    applyTheme(targetTheme);
    wasNightTime = isNight;
    initialized = true;

    return true;
}

void ThemeScheduler::refresh() {
    const DayNightConfig& config = configManager.getConfig().display.dayNight;

    if (!config.enabled) {
        Serial.println("ThemeScheduler: Disabled");
        initialized = false;
        return;
    }

    Serial.printf("ThemeScheduler: Enabled - Day theme: %s (starts %d:00), Night theme: %s (starts %d:00)\n",
        config.dayTheme.c_str(), config.dayStartHour,
        config.nightTheme.c_str(), config.nightStartHour);

    // Reset state to force re-evaluation
    initialized = false;
    currentAppliedTheme = "";

    // If time is synced, immediately apply the correct theme
    if (timeManager.isSynced()) {
        uint8_t hour = timeManager.getCurrentHour();
        bool isDay = isDayTime(hour);
        const String& targetTheme = isDay ? config.dayTheme : config.nightTheme;

        Serial.printf("ThemeScheduler: Current hour %d is %s time, applying %s theme\n",
            hour, isDay ? "day" : "night", targetTheme.c_str());

        applyTheme(targetTheme);
        wasNightTime = !isDay;
        initialized = true;
    } else {
        Serial.println("ThemeScheduler: NTP not synced yet, will apply theme when synced");
    }
}

bool ThemeScheduler::isEnabled() const {
    return configManager.getConfig().display.dayNight.enabled;
}

bool ThemeScheduler::isDayTime(uint8_t hour) const {
    const DayNightConfig& config = configManager.getConfig().display.dayNight;

    // Handle the case where day and night start hours define a simple range
    // Day time is from dayStartHour to nightStartHour
    // Night time is from nightStartHour to dayStartHour (next day)

    if (config.dayStartHour < config.nightStartHour) {
        // Normal case: day starts before night (e.g., day=7, night=20)
        // Day is [7, 20), night is [20, 7)
        return hour >= config.dayStartHour && hour < config.nightStartHour;
    } else if (config.dayStartHour > config.nightStartHour) {
        // Inverted case: day starts after night (e.g., day=20, night=7)
        // Day is [20, 7), night is [7, 20)
        return hour >= config.dayStartHour || hour < config.nightStartHour;
    } else {
        // Same hour - default to day
        return true;
    }
}

void ThemeScheduler::applyTheme(const String& themeName) {
    Serial.printf("ThemeScheduler: Setting theme to %s\n", themeName.c_str());

    // Set the theme in the theme engine
    if (themeEngine.setTheme(themeName)) {
        currentAppliedTheme = themeName;
        // Request UI rebuild to apply the new theme
        uiManager.requestRebuild();
    } else {
        Serial.printf("ThemeScheduler: WARNING - Failed to set theme %s\n", themeName.c_str());
    }
}
