#include "theme_engine.h"

// Global instance
ThemeEngine themeEngine;

// ============================================================================
// Theme Definitions
// ============================================================================

// Light Theme
// Clean, minimal iOS-inspired light theme
ThemeDefinition ThemeEngine::lightModeTheme = {
    .id = ThemeId::LIGHT_MODE,
    .name = "light_mode",
    .colors = {
        .background = lv_color_hex(0xf5f5f5),     // Light gray background
        .cardBackground = lv_color_hex(0xffffff), // White cards
        .cardHover = lv_color_hex(0xf0f0f0),      // Slightly darker on hover
        .onState = lv_color_hex(0xff9500),        // Orange when on
        .offState = lv_color_hex(0xe5e5ea),       // Light gray when off
        .textPrimary = lv_color_hex(0x000000),    // Black text
        .textSecondary = lv_color_hex(0x8e8e93),  // Gray secondary text
        .accent = lv_color_hex(0x007aff),         // iOS blue
        .border = lv_color_hex(0xe5e5ea),         // Light border
        .shadow = lv_color_hex(0x000000),         // Black shadow (low opacity)
        .neonColors = {
            lv_color_hex(0xff9500), lv_color_hex(0xff9500),
            lv_color_hex(0xff9500), lv_color_hex(0xff9500),
            lv_color_hex(0xff9500), lv_color_hex(0xff9500)
        }
    },
    .style = {
        .cardRadius = 16,
        .buttonRadius = 22,
        .borderWidth = 0,
        .shadowWidth = 10,
        .shadowOffsetY = 2,
        .shadowSpread = 0,
        .shadowOpacity = LV_OPA_10,
        .showStatusText = false,
        .glowingBorders = false,
        .isLCARS = false,
        .isCyberpunk = false
    }
};

// Neon Cyberpunk Theme
// Dark theme with vibrant neon colors per room
ThemeDefinition ThemeEngine::neonCyberpunkTheme = {
    .id = ThemeId::NEON_CYBERPUNK,
    .name = "neon_cyberpunk",
    .colors = {
        .background = lv_color_hex(0x0a0a0f),     // Very dark blue-black
        .cardBackground = lv_color_hex(0x12121a), // Dark card background
        .cardHover = lv_color_hex(0x1a1a24),      // Slightly lighter
        .onState = lv_color_hex(0x00ff88),        // Neon green (default)
        .offState = lv_color_hex(0x2a2a3a),       // Dark muted
        .textPrimary = lv_color_hex(0xffffff),    // White text
        .textSecondary = lv_color_hex(0x6a6a7a),  // Muted gray
        .accent = lv_color_hex(0xff0080),         // Neon pink
        .border = lv_color_hex(0x3a3a4a),         // Dark border
        .shadow = lv_color_hex(0x000000),         // Black shadow
        .neonColors = {
            lv_color_hex(0x00d4ff),  // Neon cyan - Living Room
            lv_color_hex(0xff0080),  // Neon pink - Bedroom
            lv_color_hex(0xffff00),  // Neon yellow - Kitchen
            lv_color_hex(0x00ff88),  // Neon green - Bathroom
            lv_color_hex(0xff6600),  // Neon orange
            lv_color_hex(0xaa00ff)   // Neon purple
        }
    },
    .style = {
        .cardRadius = 4,
        .buttonRadius = 4,
        .borderWidth = 2,
        .shadowWidth = 20,
        .shadowOffsetY = 0,
        .shadowSpread = 5,
        .shadowOpacity = LV_OPA_50,
        .showStatusText = true,
        .glowingBorders = true,
        .isLCARS = false,
        .isCyberpunk = true
    }
};

// Dark Theme (current default)
// Modern dark theme with warm orange accents
ThemeDefinition ThemeEngine::darkCleanTheme = {
    .id = ThemeId::DARK_CLEAN,
    .name = "dark_mode",
    .colors = {
        .background = lv_color_hex(0x121218),     // Very dark background
        .cardBackground = lv_color_hex(0x1e1e26), // Dark card background
        .cardHover = lv_color_hex(0x282832),      // Slightly lighter
        .onState = lv_color_hex(0xff9f0a),        // Warm orange when on
        .offState = lv_color_hex(0x3a3a44),       // Muted gray when off
        .textPrimary = lv_color_hex(0xffffff),    // White text
        .textSecondary = lv_color_hex(0x8e8e93),  // Dimmed text
        .accent = lv_color_hex(0x0a84ff),         // iOS dark mode blue
        .border = lv_color_hex(0x2a2a34),         // Subtle border
        .shadow = lv_color_hex(0x000000),         // Black shadow
        .neonColors = {
            lv_color_hex(0xff9f0a), lv_color_hex(0xff9f0a),
            lv_color_hex(0xff9f0a), lv_color_hex(0xff9f0a),
            lv_color_hex(0xff9f0a), lv_color_hex(0xff9f0a)
        }
    },
    .style = {
        .cardRadius = 16,
        .buttonRadius = 22,
        .borderWidth = 1,
        .shadowWidth = 20,
        .shadowOffsetY = 4,
        .shadowSpread = 0,
        .shadowOpacity = LV_OPA_30,
        .showStatusText = false,
        .glowingBorders = false,
        .isLCARS = false,
        .isCyberpunk = false
    }
};

// LCARS Theme
// Star Trek-inspired interface with characteristic curved frames and bold colors
ThemeDefinition ThemeEngine::lcarsTheme = {
    .id = ThemeId::LCARS,
    .name = "lcars",
    .colors = {
        .background = lv_color_hex(0x000000),     // Black background
        .cardBackground = lv_color_hex(0x664477), // Purple for cards (active)
        .cardHover = lv_color_hex(0x9966aa),      // Lighter purple
        .onState = lv_color_hex(0x664477),        // Purple for active state
        .offState = lv_color_hex(0x9977aa),       // Lighter purple for standby
        .textPrimary = lv_color_hex(0xffffff),    // White text
        .textSecondary = lv_color_hex(0xcc6600),  // Orange text for headers
        .accent = lv_color_hex(0x6688cc),         // Blue accent
        .border = lv_color_hex(0x000000),         // Black borders (gaps)
        .shadow = lv_color_hex(0x000000),         // No visible shadow
        .neonColors = {
            lv_color_hex(0xcc6600),  // Orange (sidebar)
            lv_color_hex(0xffcc99),  // Tan/beige (scene buttons)
            lv_color_hex(0x664477),  // Purple (active cards)
            lv_color_hex(0x9977aa),  // Light purple (standby cards)
            lv_color_hex(0x6688cc),  // Blue (accents)
            lv_color_hex(0xffcc66)   // Yellow (standby text)
        }
    },
    .style = {
        .cardRadius = 20,        // Rounded LCARS corners
        .buttonRadius = 15,
        .borderWidth = 0,        // LCARS uses shapes, not borders
        .shadowWidth = 0,
        .shadowOffsetY = 0,
        .shadowSpread = 0,
        .shadowOpacity = LV_OPA_TRANSP,
        .showStatusText = true,  // LCARS shows lots of text
        .glowingBorders = false,
        .isLCARS = true,
        .isCyberpunk = false
    }
};

// LCARS Color Schemes
LCARSColorScheme ThemeEngine::lcars_federation = {
    .background = lv_color_hex(0x000000),
    .primary = lv_color_hex(0xcc6600),      // Orange
    .secondary = lv_color_hex(0xffcc99),    // Tan/beige
    .accent = lv_color_hex(0x9999ff),       // Purple
    .highlight = lv_color_hex(0x99ccff),    // Light blue
    .text = lv_color_hex(0xffffff),
    .textDark = lv_color_hex(0x000000)
};

LCARSColorScheme ThemeEngine::lcars_medical = {
    .background = lv_color_hex(0x000000),
    .primary = lv_color_hex(0x6699ff),      // Blue
    .secondary = lv_color_hex(0x99ccff),    // Light blue
    .accent = lv_color_hex(0x00ff99),       // Teal/green
    .highlight = lv_color_hex(0xffffff),    // White
    .text = lv_color_hex(0xffffff),
    .textDark = lv_color_hex(0x000000)
};

LCARSColorScheme ThemeEngine::lcars_engineering = {
    .background = lv_color_hex(0x000000),
    .primary = lv_color_hex(0xff9900),      // Bright orange
    .secondary = lv_color_hex(0xffcc00),    // Yellow
    .accent = lv_color_hex(0xff6600),       // Red-orange
    .highlight = lv_color_hex(0xffff99),    // Light yellow
    .text = lv_color_hex(0xffffff),
    .textDark = lv_color_hex(0x000000)
};

LCARSColorScheme ThemeEngine::lcars_tactical = {
    .background = lv_color_hex(0x000000),
    .primary = lv_color_hex(0xcc3333),      // Red
    .secondary = lv_color_hex(0xff6666),    // Light red
    .accent = lv_color_hex(0xff9900),       // Orange
    .highlight = lv_color_hex(0xffcc00),    // Yellow alert
    .text = lv_color_hex(0xffffff),
    .textDark = lv_color_hex(0x000000)
};


// ============================================================================
// ThemeEngine Implementation
// ============================================================================

ThemeEngine::ThemeEngine() : currentTheme(ThemeId::DARK_CLEAN) {
}

void ThemeEngine::begin() {
    Serial.println("ThemeEngine: Initialized");
}

bool ThemeEngine::setTheme(const String& themeName) {
    Serial.printf("ThemeEngine: setTheme called with '%s'\n", themeName.c_str());

    const ThemeDefinition* theme = getThemeByName(themeName);
    if (theme) {
        currentTheme = theme->id;
        Serial.printf("ThemeEngine: Set currentTheme to id=%d (name=%s)\n",
                      (int)currentTheme, theme->name);
        return true;
    }
    Serial.printf("ThemeEngine: Unknown theme '%s', keeping current\n", themeName.c_str());
    return false;
}

void ThemeEngine::setTheme(ThemeId id) {
    currentTheme = id;
    Serial.printf("ThemeEngine: Set theme to ID %d\n", (int)id);
}

ThemeId ThemeEngine::getCurrentThemeId() const {
    return currentTheme;
}

String ThemeEngine::getCurrentThemeName() const {
    return String(getThemeById(currentTheme).name);
}

const ThemeDefinition& ThemeEngine::getCurrentTheme() const {
    return getThemeById(currentTheme);
}

const ThemeDefinition* ThemeEngine::getThemeByName(const String& name) const {
    if (name == "light_mode") return &lightModeTheme;
    if (name == "neon_cyberpunk") return &neonCyberpunkTheme;
    if (name == "dark_mode") return &darkCleanTheme;
    if (name == "lcars") return &lcarsTheme;
    return nullptr;
}

const ThemeDefinition& ThemeEngine::getThemeById(ThemeId id) const {
    switch (id) {
        case ThemeId::LIGHT_MODE: return lightModeTheme;
        case ThemeId::NEON_CYBERPUNK: return neonCyberpunkTheme;
        case ThemeId::LCARS: return lcarsTheme;
        case ThemeId::DARK_CLEAN:
        default: return darkCleanTheme;
    }
}

const LCARSColorScheme* ThemeEngine::getLCARSColorScheme(const String& schemeName) const {
    if (schemeName == "federation") return &lcars_federation;
    if (schemeName == "medical") return &lcars_medical;
    if (schemeName == "engineering") return &lcars_engineering;
    if (schemeName == "tactical") return &lcars_tactical;
    return &lcars_federation;  // Default
}

bool ThemeEngine::isLCARS() const {
    return getCurrentTheme().style.isLCARS;
}

bool ThemeEngine::isCyberpunk() const {
    return getCurrentTheme().style.isCyberpunk;
}


void ThemeEngine::applyToScreen(lv_obj_t* screen) {
    const ThemeDefinition& theme = getCurrentTheme();

    Serial.printf("ThemeEngine: Applying theme '%s' (id=%d), background=0x%06X\n",
                  theme.name, (int)currentTheme,
                  (unsigned int)lv_color_to32(theme.colors.background));

    lv_obj_set_style_bg_color(screen, theme.colors.background, 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
}

void ThemeEngine::styleCard(lv_obj_t* obj, bool isOn, int colorIndex) {
    const ThemeDefinition& theme = getCurrentTheme();

    // Don't use lv_obj_remove_style_all() as it can reset position/size
    // Instead, set each style property explicitly
    lv_obj_set_style_bg_color(obj, theme.colors.cardBackground, 0);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(obj, theme.style.cardRadius, 0);
    lv_obj_set_style_pad_all(obj, 0, 0);  // Remove default padding
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_SCROLLABLE);  // Disable scrolling

    // Border
    if (theme.style.borderWidth > 0) {
        lv_obj_set_style_border_width(obj, theme.style.borderWidth, 0);

        if (theme.style.glowingBorders && isOn) {
            // Glowing border for neon theme
            lv_color_t neonColor = theme.colors.neonColors[colorIndex % 6];
            lv_obj_set_style_border_color(obj, neonColor, 0);
        } else {
            lv_obj_set_style_border_color(obj, theme.colors.border, 0);
        }
    }

    // Shadow/glow
    lv_obj_set_style_shadow_width(obj, theme.style.shadowWidth, 0);
    lv_obj_set_style_shadow_opa(obj, theme.style.shadowOpacity, 0);
    lv_obj_set_style_shadow_ofs_y(obj, theme.style.shadowOffsetY, 0);

    if (theme.style.glowingBorders && isOn) {
        // Glow effect for neon theme
        lv_color_t neonColor = theme.colors.neonColors[colorIndex % 6];
        lv_obj_set_style_shadow_color(obj, neonColor, 0);
        lv_obj_set_style_shadow_spread(obj, theme.style.shadowSpread, 0);
    } else {
        lv_obj_set_style_shadow_color(obj, theme.colors.shadow, 0);
    }
}

void ThemeEngine::styleButton(lv_obj_t* btn, bool isPrimary) {
    const ThemeDefinition& theme = getCurrentTheme();

    lv_obj_set_style_radius(btn, theme.style.buttonRadius, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);

    if (isPrimary) {
        lv_obj_set_style_bg_color(btn, theme.colors.accent, 0);
    } else {
        lv_obj_set_style_bg_color(btn, theme.colors.offState, 0);
    }
}

void ThemeEngine::styleSwitch(lv_obj_t* sw) {
    const ThemeDefinition& theme = getCurrentTheme();

    lv_obj_set_style_bg_color(sw, theme.colors.offState, 0);
    lv_obj_set_style_bg_color(sw, theme.colors.onState, LV_PART_INDICATOR | LV_STATE_CHECKED);
    lv_obj_set_style_bg_color(sw, lv_color_hex(0xffffff), LV_PART_KNOB);
    lv_obj_set_style_pad_all(sw, -2, LV_PART_KNOB);
}

void ThemeEngine::styleLabel(lv_obj_t* label, bool isPrimary) {
    const ThemeDefinition& theme = getCurrentTheme();

    if (isPrimary) {
        lv_obj_set_style_text_color(label, theme.colors.textPrimary, 0);
    } else {
        lv_obj_set_style_text_color(label, theme.colors.textSecondary, 0);
    }
}

void ThemeEngine::styleHeader(lv_obj_t* header) {
    const ThemeDefinition& theme = getCurrentTheme();

    // Set styles without removing all (preserves position/size)
    lv_obj_set_style_bg_color(header, theme.colors.cardBackground, 0);
    lv_obj_set_style_bg_opa(header, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(header, 0, 0);
    lv_obj_set_style_border_width(header, 0, 0);
    lv_obj_clear_flag(header, LV_OBJ_FLAG_SCROLLABLE);

    // Shadow below header
    lv_obj_set_style_shadow_width(header, 12, 0);
    lv_obj_set_style_shadow_color(header, theme.colors.shadow, 0);
    lv_obj_set_style_shadow_opa(header, LV_OPA_40, 0);
    lv_obj_set_style_shadow_ofs_y(header, 2, 0);
}

void ThemeEngine::styleActionBar(lv_obj_t* bar) {
    const ThemeDefinition& theme = getCurrentTheme();

    // Set styles without removing all (preserves position/size)
    lv_obj_set_style_bg_color(bar, theme.colors.cardBackground, 0);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);

    // Cyberpunk theme uses sharp corners, others use rounded
    if (theme.style.isCyberpunk) {
        lv_obj_set_style_radius(bar, 0, 0);
        // Make it transparent to remove the background entirely
        lv_obj_set_style_bg_opa(bar, LV_OPA_TRANSP, 0);
        lv_obj_set_style_shadow_width(bar, 0, 0);
    } else {
        lv_obj_set_style_radius(bar, 30, 0);
        lv_obj_set_style_shadow_width(bar, 15, 0);
        lv_obj_set_style_shadow_color(bar, theme.colors.shadow, 0);
        lv_obj_set_style_shadow_opa(bar, LV_OPA_30, 0);
    }

    lv_obj_set_style_pad_all(bar, 0, 0);
    lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);

    if (theme.style.borderWidth > 0 && !theme.style.isCyberpunk) {
        lv_obj_set_style_border_width(bar, theme.style.borderWidth, 0);
        lv_obj_set_style_border_color(bar, theme.colors.border, 0);
    } else {
        lv_obj_set_style_border_width(bar, 0, 0);
    }
}

lv_color_t ThemeEngine::getIconColor(bool isOn, int colorIndex) {
    const ThemeDefinition& theme = getCurrentTheme();

    if (isOn) {
        if (theme.id == ThemeId::NEON_CYBERPUNK) {
            return theme.colors.neonColors[colorIndex % 6];
        }
        return theme.colors.onState;
    }
    return theme.colors.textSecondary;
}

const char* ThemeEngine::getStateText(bool isOn) {
    return isOn ? "ON" : "OFF";
}

bool ThemeEngine::showsStatusText() const {
    return getCurrentTheme().style.showStatusText;
}
