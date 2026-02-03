#include "brightness_scheduler.h"
#include "time_manager.h"
#include "ui_manager.h"

// Global instance
BrightnessScheduler brightnessScheduler;

BrightnessScheduler::BrightnessScheduler()
    : state(SchedulerState::SCHEDULED)
    , currentScheduledBrightness(80)
    , lastAppliedBrightness(255)  // Invalid value to force initial update
    , wakeStartTime(0)
    , wakeGraceEndTime(0)
    , currentPeriodIndex(-1) {
}

void BrightnessScheduler::begin() {
    Serial.println("BrightnessScheduler: Initializing...");
    refresh();
}

bool BrightnessScheduler::update() {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    // Skip if scheduling disabled
    if (!schedule.enabled) {
        return false;
    }

    // Skip if no periods configured
    if (schedule.periodCount == 0) {
        return false;
    }

    // Check if time is synced - if not, use default 50% brightness
    if (!timeManager.isSynced()) {
        if (lastAppliedBrightness != 50) {
            Serial.println("BrightnessScheduler: NTP not synced, using default 50% brightness");
            applyBrightness(50);
            lastAppliedBrightness = 50;
            return true;
        }
        return false;
    }

    bool brightnessChanged = false;

    // Handle wake timeout
    if (state == SchedulerState::AWAKE) {
        unsigned long elapsed = millis() - wakeStartTime;
        if (elapsed >= (schedule.displayTimeout * 1000UL)) {
            Serial.println("BrightnessScheduler: Wake timeout, returning to schedule");
            state = SchedulerState::SCHEDULED;
            // Force brightness reapply by invalidating lastAppliedBrightness
            lastAppliedBrightness = 255;
        }
    }

    // Update scheduled brightness based on current time
    uint8_t hour = timeManager.getCurrentHour();
    uint8_t minute = timeManager.getCurrentMinute();
    int8_t periodIndex = findActivePeriod(hour, minute);

    if (periodIndex != currentPeriodIndex) {
        currentPeriodIndex = periodIndex;
        currentScheduledBrightness = getPeriodBrightness(periodIndex);
        Serial.printf("BrightnessScheduler: Period changed to %d, brightness=%d\n",
            periodIndex, currentScheduledBrightness);
    }

    // Determine target brightness based on state
    uint8_t targetBrightness;
    if (state == SchedulerState::AWAKE) {
        targetBrightness = schedule.touchBrightness;
    } else {
        targetBrightness = currentScheduledBrightness;
    }

    // Apply brightness if changed
    if (targetBrightness != lastAppliedBrightness) {
        applyBrightness(targetBrightness);
        lastAppliedBrightness = targetBrightness;
        brightnessChanged = true;
    }

    return brightnessChanged;
}

bool BrightnessScheduler::onTouchDetected() {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    // Skip if scheduling disabled
    if (!schedule.enabled) {
        return false;  // Don't block buttons
    }

    // Check the actual current brightness from UIManager
    uint8_t actualBrightness = uiManager.getBrightness();

    // If display is very dim (<=5%), wake it up and block the button action
    // This works even if NTP hasn't synced yet
    if (actualBrightness <= 5) {
        Serial.printf("BrightnessScheduler: Touch detected at %d%% brightness, waking display (blocking for %lums)\n",
            actualBrightness, WAKE_GRACE_PERIOD_MS);
        state = SchedulerState::AWAKE;
        wakeStartTime = millis();
        wakeGraceEndTime = millis() + WAKE_GRACE_PERIOD_MS;  // Block buttons for 500ms

        // Apply wake brightness immediately
        applyBrightness(schedule.touchBrightness);
        lastAppliedBrightness = schedule.touchBrightness;

        return true;  // Block button action
    }

    // If already awake, reset the timeout
    if (state == SchedulerState::AWAKE) {
        wakeStartTime = millis();
    }

    return false;  // Don't block button action
}

bool BrightnessScheduler::shouldBlockButtons() const {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    if (!schedule.enabled) {
        return false;
    }

    // Block buttons during wake grace period (500ms after display wakes from 0%)
    if (millis() < wakeGraceEndTime) {
        return true;
    }

    // Block buttons when actual brightness is very low (<=5%)
    return uiManager.getBrightness() <= 5;
}

uint8_t BrightnessScheduler::getTargetBrightness() const {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    if (!schedule.enabled) {
        return configManager.getConfig().display.brightness;
    }

    if (state == SchedulerState::AWAKE) {
        return schedule.touchBrightness;
    }

    // If NTP not synced yet, use default 50%
    if (!timeManager.isSynced()) {
        return 50;
    }

    return currentScheduledBrightness;
}

bool BrightnessScheduler::isEnabled() const {
    return configManager.getConfig().display.schedule.enabled;
}

void BrightnessScheduler::refresh() {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    if (!schedule.enabled) {
        Serial.println("BrightnessScheduler: Disabled");
        return;
    }

    // Update timezone
    timeManager.setTimezone(schedule.timezone);

    // Reset state
    state = SchedulerState::SCHEDULED;
    currentPeriodIndex = -1;
    lastAppliedBrightness = 255;  // Force re-application

    Serial.printf("BrightnessScheduler: Enabled with %d periods, timeout=%ds\n",
        schedule.periodCount, schedule.displayTimeout);

    if (schedule.periodCount == 0) {
        Serial.println("BrightnessScheduler: WARNING - No periods configured!");
    }

    for (uint8_t i = 0; i < schedule.periodCount; i++) {
        Serial.printf("  Period %d: %s at %02d:%02d -> %d%%\n",
            i, schedule.periods[i].name.c_str(),
            schedule.periods[i].startHour, schedule.periods[i].startMinute,
            schedule.periods[i].brightness);
    }

    // If time is already synced, immediately find and apply the correct period
    if (timeManager.isSynced() && schedule.periodCount > 0) {
        uint8_t hour = timeManager.getCurrentHour();
        uint8_t minute = timeManager.getCurrentMinute();
        int8_t periodIndex = findActivePeriod(hour, minute);
        if (periodIndex >= 0) {
            currentPeriodIndex = periodIndex;
            currentScheduledBrightness = schedule.periods[periodIndex].brightness;
            Serial.printf("BrightnessScheduler: Initial period %d (%s), brightness=%d%%\n",
                periodIndex, schedule.periods[periodIndex].name.c_str(), currentScheduledBrightness);
            applyBrightness(currentScheduledBrightness);
            lastAppliedBrightness = currentScheduledBrightness;
        }
    } else if (!timeManager.isSynced()) {
        // NTP not synced yet, use default 50% brightness
        Serial.println("BrightnessScheduler: NTP not synced, applying default 50% brightness");
        applyBrightness(50);
        lastAppliedBrightness = 50;
    }
}

int8_t BrightnessScheduler::findActivePeriod(uint8_t hour, uint8_t minute) const {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    if (schedule.periodCount == 0) {
        return -1;
    }

    uint16_t currentMinutes = toMinutesSinceMidnight(hour, minute);

    // Find the period with the latest start time that is <= current time
    // If none found (current time is before first period), use the last period (wrap around)
    int8_t activePeriod = schedule.periodCount - 1;  // Default to last period (wrap around)

    for (uint8_t i = 0; i < schedule.periodCount; i++) {
        uint16_t periodStart = toMinutesSinceMidnight(
            schedule.periods[i].startHour,
            schedule.periods[i].startMinute
        );

        if (periodStart <= currentMinutes) {
            activePeriod = i;
        } else {
            // Periods are sorted by start time, so once we find one that's later
            // than current time, we've found our answer (it's the previous one)
            break;
        }
    }

    return activePeriod;
}

uint8_t BrightnessScheduler::getPeriodBrightness(int8_t periodIndex) const {
    const BrightnessScheduleConfig& schedule = configManager.getConfig().display.schedule;

    if (periodIndex < 0 || periodIndex >= schedule.periodCount) {
        // Fallback to manual brightness
        return configManager.getConfig().display.brightness;
    }

    return schedule.periods[periodIndex].brightness;
}

void BrightnessScheduler::applyBrightness(uint8_t brightness) {
    Serial.printf("BrightnessScheduler: Setting brightness to %d\n", brightness);
    uiManager.setBrightness(brightness);
}

uint16_t BrightnessScheduler::toMinutesSinceMidnight(uint8_t hour, uint8_t minute) {
    return (uint16_t)hour * 60 + minute;
}
