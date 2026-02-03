#ifndef BRIGHTNESS_SCHEDULER_H
#define BRIGHTNESS_SCHEDULER_H

#include <Arduino.h>
#include "config_manager.h"

// Scheduler states
enum class SchedulerState {
    SCHEDULED,  // Following the brightness schedule
    AWAKE       // Temporarily woken by touch
};

class BrightnessScheduler {
public:
    BrightnessScheduler();

    // Initialize with schedule config
    void begin();

    // Update function - call from main loop
    // Returns true if brightness changed
    bool update();

    // Handle touch detection - call from touch callback
    // Returns true if the touch should be consumed (button blocked)
    bool onTouchDetected();

    // Check if buttons should be blocked (when scheduled brightness is 0%)
    bool shouldBlockButtons() const;

    // Get the current target brightness (0-100)
    uint8_t getTargetBrightness() const;

    // Check if scheduler is active
    bool isEnabled() const;

    // Force re-evaluation of schedule (call after config update)
    void refresh();

private:
    SchedulerState state;
    uint8_t currentScheduledBrightness;
    uint8_t lastAppliedBrightness;
    unsigned long wakeStartTime;
    int8_t currentPeriodIndex;

    // Find which period should be active for the given time
    int8_t findActivePeriod(uint8_t hour, uint8_t minute) const;

    // Get brightness for a specific period (-1 = use manual brightness)
    uint8_t getPeriodBrightness(int8_t periodIndex) const;

    // Apply brightness to the display
    void applyBrightness(uint8_t brightness);

    // Calculate minutes since midnight
    static uint16_t toMinutesSinceMidnight(uint8_t hour, uint8_t minute);
};

// Global instance
extern BrightnessScheduler brightnessScheduler;

#endif // BRIGHTNESS_SCHEDULER_H
