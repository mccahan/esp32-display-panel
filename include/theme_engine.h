#ifndef THEME_ENGINE_H
#define THEME_ENGINE_H

#include <Arduino.h>
#include <lvgl.h>

// Available themes
enum class ThemeId {
    LIGHT_MODE,
    NEON_CYBERPUNK,
    DARK_CLEAN,
    LCARS
};

// Theme color palette
struct ThemeColors {
    lv_color_t background;
    lv_color_t cardBackground;
    lv_color_t cardHover;
    lv_color_t onState;
    lv_color_t offState;
    lv_color_t textPrimary;
    lv_color_t textSecondary;
    lv_color_t accent;
    lv_color_t border;
    lv_color_t shadow;

    // Neon theme specific colors (per-room)
    lv_color_t neonColors[6];
};

// Theme style parameters
struct ThemeStyle {
    uint8_t cardRadius;
    uint8_t buttonRadius;
    uint8_t borderWidth;
    uint8_t shadowWidth;
    uint8_t shadowOffsetY;
    uint8_t shadowSpread;
    lv_opa_t shadowOpacity;
    bool showStatusText;  // For neon theme
    bool glowingBorders;  // For neon theme
    bool isLCARS;         // LCARS special layout mode
    bool isCyberpunk;     // Cyberpunk centered icon layout (no toggles)
};

// LCARS color scheme
struct LCARSColorScheme {
    lv_color_t background;
    lv_color_t primary;      // Main frame color (orange for federation)
    lv_color_t secondary;    // Secondary color (tan/beige)
    lv_color_t accent;       // Accent color (blue/red buttons)
    lv_color_t highlight;    // Highlight color (bright indicators)
    lv_color_t text;         // Text color
    lv_color_t textDark;     // Text on light backgrounds
};

// Complete theme definition
struct ThemeDefinition {
    ThemeId id;
    const char* name;
    ThemeColors colors;
    ThemeStyle style;
};

class ThemeEngine {
public:
    ThemeEngine();

    // Initialize the theme engine
    void begin();

    // Set current theme by name
    bool setTheme(const String& themeName);

    // Set current theme by ID
    void setTheme(ThemeId id);

    // Get current theme ID
    ThemeId getCurrentThemeId() const;

    // Get current theme name
    String getCurrentThemeName() const;

    // Get current theme definition
    const ThemeDefinition& getCurrentTheme() const;

    // Get theme by name
    const ThemeDefinition* getThemeByName(const String& name) const;

    // Apply theme to screen background
    void applyToScreen(lv_obj_t* screen);

    // Style a card/panel object
    void styleCard(lv_obj_t* obj, bool isOn = false, int colorIndex = 0);

    // Style a button
    void styleButton(lv_obj_t* btn, bool isPrimary = false);

    // Style a switch/toggle
    void styleSwitch(lv_obj_t* sw);

    // Style a label
    void styleLabel(lv_obj_t* label, bool isPrimary = true);

    // Style header bar
    void styleHeader(lv_obj_t* header);

    // Style bottom action bar
    void styleActionBar(lv_obj_t* bar);

    // Get icon color based on state
    lv_color_t getIconColor(bool isOn, int colorIndex = 0);

    // Get text for on/off state (for neon theme)
    const char* getStateText(bool isOn);

    // Check if current theme shows status text
    bool showsStatusText() const;

    // Get LCARS color scheme by name
    const LCARSColorScheme* getLCARSColorScheme(const String& schemeName) const;

    // Check if current theme is LCARS
    bool isLCARS() const;

    // Check if current theme is Cyberpunk style (centered icons, no toggles)
    bool isCyberpunk() const;


private:
    ThemeId currentTheme;

    // Theme definitions
    static ThemeDefinition lightModeTheme;
    static ThemeDefinition neonCyberpunkTheme;
    static ThemeDefinition darkCleanTheme;
    static ThemeDefinition lcarsTheme;

    // LCARS color schemes
    static LCARSColorScheme lcars_federation;
    static LCARSColorScheme lcars_medical;
    static LCARSColorScheme lcars_engineering;
    static LCARSColorScheme lcars_tactical;

    // Get theme definition by ID
    const ThemeDefinition& getThemeById(ThemeId id) const;
};

// Global instance
extern ThemeEngine themeEngine;

#endif // THEME_ENGINE_H
