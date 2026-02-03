#ifndef THEME_SCHEDULER_H
#define THEME_SCHEDULER_H

#include <Arduino.h>
#include "config_manager.h"

class ThemeScheduler {
public:
    ThemeScheduler();

    // Initialize the theme scheduler
    void begin();

    // Update function - call from main loop
    // Returns true if theme changed
    bool update();

    // Force re-evaluation (call after config update)
    void refresh();

    // Check if scheduler is active
    bool isEnabled() const;

private:
    String currentAppliedTheme;
    bool wasNightTime;
    bool initialized;

    // Determine if current hour falls in night period
    bool isDayTime(uint8_t hour) const;

    // Apply theme change
    // triggerRebuild: if false, just sets theme without requesting UI rebuild
    void applyTheme(const String& themeName, bool triggerRebuild = true);
};

// Global instance
extern ThemeScheduler themeScheduler;

#endif // THEME_SCHEDULER_H
