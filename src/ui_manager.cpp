#include "ui_manager.h"
#include "lcars_elbow.h"
#include "fan_icon.h"
#include "garage_icon.h"
#include "sleep_icon.h"
#include "ceiling_light_icon.h"
#include "bulb_icon.h"
#include "door_icon.h"
#include "moon_icon.h"
#include "sun_icon.h"
#include <WiFi.h>

// Global instance
UIManager uiManager;

// Screen dimensions
#define SCREEN_WIDTH 480
#define SCREEN_HEIGHT 480

UIManager::UIManager()
    : screen(nullptr)
    , header(nullptr)
    , contentArea(nullptr)
    , actionBar(nullptr)
    , numButtons(0)
    , numScenes(0)
    , buttonCallback(nullptr)
    , sceneCallback(nullptr)
    , currentBrightness(80)
    , needsRebuild(false)
{
    memset(buttonCards, 0, sizeof(buttonCards));
    memset(sceneButtons, 0, sizeof(sceneButtons));
}

void UIManager::begin() {
    Serial.println("UIManager: Initializing...");
    setupBacklightPWM();
    needsRebuild = false;
}

void UIManager::requestRebuild() {
    needsRebuild = true;
    Serial.println("UIManager: Rebuild requested (will execute in main loop)");
}

// Animation state for brightness fade during rebuild
static bool rebuildFadeInProgress = false;
static uint8_t rebuildTargetBrightness = 80;
static int rebuildFadeStep = 0;  // 0=fade out, 1=rebuild, 2=fade in, 3=done

void UIManager::update() {
    if (needsRebuild && !rebuildFadeInProgress) {
        needsRebuild = false;
        rebuildFadeInProgress = true;
        rebuildFadeStep = 0;

        // Store target brightness before fading
        const DeviceConfig& config = configManager.getConfig();
        rebuildTargetBrightness = config.display.brightness;

        Serial.println("UIManager: Starting rebuild with brightness fade");
    }

    // Handle multi-step rebuild with brightness animation
    if (rebuildFadeInProgress) {
        static unsigned long lastFadeTime = 0;
        static uint8_t fadeValue = 100;
        unsigned long now = millis();

        switch (rebuildFadeStep) {
            case 0:  // Fade out
                if (now - lastFadeTime >= 10) {  // ~100 FPS smooth fade
                    lastFadeTime = now;
                    if (fadeValue > 0) {
                        fadeValue = (fadeValue > 5) ? fadeValue - 5 : 0;
                        setBrightness(fadeValue);
                    } else {
                        Serial.println("UIManager: Fade out complete, rebuilding UI");
                        rebuildFadeStep = 1;
                    }
                }
                break;

            case 1:  // Rebuild UI (instant)
                rebuildUI();
                fadeValue = 0;
                rebuildFadeStep = 2;
                lastFadeTime = now;
                Serial.println("UIManager: UI rebuilt, starting fade in");
                break;

            case 2:  // Fade in
                if (now - lastFadeTime >= 10) {  // ~100 FPS smooth fade
                    lastFadeTime = now;
                    if (fadeValue < rebuildTargetBrightness) {
                        uint8_t step = (rebuildTargetBrightness > fadeValue + 5) ? 5 : (rebuildTargetBrightness - fadeValue);
                        fadeValue += step;
                        setBrightness(fadeValue);
                    } else {
                        setBrightness(rebuildTargetBrightness);
                        Serial.printf("UIManager: Fade in complete, brightness at %d%%\n", rebuildTargetBrightness);
                        rebuildFadeStep = 3;
                    }
                }
                break;

            case 3:  // Done
                rebuildFadeInProgress = false;
                rebuildFadeStep = 0;
                fadeValue = 100;  // Reset for next rebuild
                break;
        }
    }
}

void UIManager::setupBacklightPWM() {
    // Setup LEDC PWM for backlight control
    ledcSetup(BACKLIGHT_PWM_CHANNEL, 5000, 8);  // 5kHz, 8-bit resolution
    ledcAttachPin(BACKLIGHT_PIN, BACKLIGHT_PWM_CHANNEL);

    // Apply initial brightness from config
    const DeviceConfig& config = configManager.getConfig();
    setBrightness(config.display.brightness);
}

void UIManager::setBrightness(uint8_t brightness) {
    currentBrightness = brightness;

    // Map brightness to PWM value with minimum threshold
    // This display's backlight requires ~50% duty cycle minimum to stay lit
    // 0% = off, 1-100% maps to PWM 128-255 to ensure visibility
    uint8_t pwmValue;
    if (brightness == 0) {
        pwmValue = 0;  // Allow complete off
    } else {
        // Map 1-100 to 128-255 (minimum 50% duty cycle for this display)
        pwmValue = map(brightness, 1, 100, 128, 255);
    }

    ledcWrite(BACKLIGHT_PWM_CHANNEL, pwmValue);
    Serial.printf("UIManager: Brightness set to %d%% (PWM: %d)\n", brightness, pwmValue);
}

uint8_t UIManager::getBrightness() const {
    return currentBrightness;
}

void UIManager::createUI() {
    Serial.println("UIManager: Creating UI...");

    const DeviceConfig& config = configManager.getConfig();
    const String& themeName = config.display.theme;

    // Set theme
    themeEngine.setTheme(themeName);
    Serial.printf("UIManager: Using theme '%s'\n", themeName.c_str());

    // Get screen and apply theme background
    screen = lv_scr_act();
    lv_obj_set_layout(screen, 0);  // 0 = no layout in LVGL 8
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    themeEngine.applyToScreen(screen);

    // Store button/scene counts
    numButtons = config.buttons.size();
    numScenes = config.scenes.size();

    Serial.printf("UIManager: Creating UI with %d buttons, %d scenes\n", numButtons, numScenes);

    // Theme-specific layouts
    if (themeEngine.isLCARS()) {
        createLCARSLayout();
    } else {
        // Standard layout
        createHeader();
        createButtonGrid();

        if (numScenes > 0) {
            createActionBar();
        }

        // Add Cyberpunk-specific decorations
        if (themeEngine.isCyberpunk()) {
            createCyberpunkDecorations();
        }
    }

    // Create fan speed overlay (hidden initially) - works with all themes
    createFanOverlay();

    Serial.println("UIManager: UI created successfully");
}

void UIManager::rebuildUI() {
    Serial.println("UIManager: Rebuilding UI...");

    // Clear existing UI (except screen)
    lv_obj_clean(lv_scr_act());

    // Reset tracking
    memset(buttonCards, 0, sizeof(buttonCards));
    memset(sceneButtons, 0, sizeof(sceneButtons));
    numButtons = 0;
    numScenes = 0;
    header = nullptr;
    contentArea = nullptr;
    actionBar = nullptr;

    // Recreate
    createUI();
}

void UIManager::createHeader() {
    const DeviceConfig& config = configManager.getConfig();
    const ThemeDefinition& theme = themeEngine.getCurrentTheme();

    header = lv_obj_create(screen);
    lv_obj_set_layout(header, 0);
    lv_obj_clear_flag(header, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(header, SCREEN_WIDTH, 70);
    lv_obj_set_pos(header, 0, 0);
    themeEngine.styleHeader(header);

    Serial.printf("UIManager: Created header at (0, 0) size %dx70\n", SCREEN_WIDTH);

    if (themeEngine.isCyberpunk()) {
        // Cyberpunk style header with tech accents
        lv_color_t neonCyan = lv_color_hex(0x00d4ff);
        lv_color_t neonPink = lv_color_hex(0xff0080);
        lv_color_t neonYellow = lv_color_hex(0xffff00);

        // Left accent bar (vertical cyan line)
        lv_obj_t* leftAccent = lv_obj_create(header);
        lv_obj_clear_flag(leftAccent, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(leftAccent, 3, 50);
        lv_obj_set_pos(leftAccent, 10, 10);
        lv_obj_set_style_bg_color(leftAccent, neonCyan, 0);
        lv_obj_set_style_bg_opa(leftAccent, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(leftAccent, 0, 0);
        lv_obj_set_style_radius(leftAccent, 0, 0);
        lv_obj_set_style_shadow_width(leftAccent, 8, 0);
        lv_obj_set_style_shadow_color(leftAccent, neonCyan, 0);
        lv_obj_set_style_shadow_opa(leftAccent, LV_OPA_70, 0);

        // Title with glow
        lv_obj_t* title = lv_label_create(header);
        lv_label_set_text(title, "// SMART_HOME");
        lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
        lv_obj_set_style_text_color(title, neonCyan, 0);
        lv_obj_align(title, LV_ALIGN_LEFT_MID, 22, -10);

        // Subtitle with version
        lv_obj_t* subtitle = lv_label_create(header);
        lv_label_set_text(subtitle, "CTRL_PANEL v2.1 [ACTIVE]");
        lv_obj_set_style_text_font(subtitle, &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_color(subtitle, theme.colors.textSecondary, 0);
        lv_obj_align(subtitle, LV_ALIGN_LEFT_MID, 22, 12);

        // Right side status indicator (blinking dot effect - static for now)
        lv_obj_t* statusDot = lv_obj_create(header);
        lv_obj_clear_flag(statusDot, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(statusDot, 8, 8);
        lv_obj_align(statusDot, LV_ALIGN_RIGHT_MID, -60, -10);
        lv_obj_set_style_bg_color(statusDot, lv_color_hex(0x00ff88), 0);
        lv_obj_set_style_bg_opa(statusDot, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(statusDot, 0, 0);
        lv_obj_set_style_radius(statusDot, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_shadow_width(statusDot, 10, 0);
        lv_obj_set_style_shadow_color(statusDot, lv_color_hex(0x00ff88), 0);
        lv_obj_set_style_shadow_opa(statusDot, LV_OPA_80, 0);

        // Status text
        lv_obj_t* statusText = lv_label_create(header);
        lv_label_set_text(statusText, "SYS_OK");
        lv_obj_set_style_text_font(statusText, &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_color(statusText, lv_color_hex(0x00ff88), 0);
        lv_obj_align(statusText, LV_ALIGN_RIGHT_MID, -15, -10);

        // Connection indicator
        lv_obj_t* connText = lv_label_create(header);
        lv_label_set_text(connText, "NET::CONNECTED");
        lv_obj_set_style_text_font(connText, &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_color(connText, theme.colors.textSecondary, 0);
        lv_obj_align(connText, LV_ALIGN_RIGHT_MID, -15, 10);

        // Horizontal scan line decoration
        lv_obj_t* scanLine = lv_obj_create(header);
        lv_obj_clear_flag(scanLine, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(scanLine, SCREEN_WIDTH - 40, 1);
        lv_obj_align(scanLine, LV_ALIGN_BOTTOM_MID, 0, -5);
        lv_obj_set_style_bg_color(scanLine, neonCyan, 0);
        lv_obj_set_style_bg_opa(scanLine, LV_OPA_40, 0);
        lv_obj_set_style_border_width(scanLine, 0, 0);
    } else {
        // Standard style: device name with light count
        lv_obj_t* title = lv_label_create(header);
        String titleText = config.device.name.length() > 0 ? config.device.name : "Home";
        lv_label_set_text(title, titleText.c_str());
        lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
        themeEngine.styleLabel(title, true);
        lv_obj_align(title, LV_ALIGN_LEFT_MID, 20, 0);

        lv_obj_t* subtitle = lv_label_create(header);
        String subtitleText = String(numButtons) + " " + (numButtons == 1 ? "Light" : "Lights");
        lv_label_set_text(subtitle, subtitleText.c_str());
        lv_obj_set_style_text_font(subtitle, &lv_font_montserrat_14, 0);
        themeEngine.styleLabel(subtitle, false);
        lv_obj_align(subtitle, LV_ALIGN_RIGHT_MID, -20, 0);
    }
}

void UIManager::calculateGridLayout(int numButtons, int& cols, int& rows,
                                    int& cardWidth, int& cardHeight, int& gap) {
    // Layout calculations based on button count
    // Available area: 480x480, header=70px, content starts at y=90
    // Action bar if present: 60px, at y=360 (leaving ~40px margin)

    gap = 20;
    int availableHeight = numScenes > 0 ? 250 : 340;  // Less height if action bar present
    int startY = 90;

    switch (numButtons) {
        case 2:
            cols = 2;
            rows = 1;
            cardWidth = 200;
            cardHeight = 110;
            break;
        case 3:
            cols = 3;
            rows = 1;
            cardWidth = 140;
            cardHeight = 110;
            break;
        case 4:
            cols = 2;
            rows = 2;
            cardWidth = 200;
            cardHeight = 110;
            break;
        case 5:
            cols = 3;
            rows = 2;
            cardWidth = 140;
            cardHeight = 110;
            break;
        case 6:
            cols = 3;
            rows = 2;
            cardWidth = 140;
            cardHeight = 110;
            break;
        default:
            // Fallback for 1 button or invalid count
            cols = 1;
            rows = 1;
            cardWidth = 200;
            cardHeight = 110;
            break;
    }
}

void UIManager::createButtonGrid() {
    const DeviceConfig& config = configManager.getConfig();

    if (numButtons == 0) {
        Serial.println("UIManager: No buttons configured");
        return;
    }

    int cols, rows, cardWidth, cardHeight, gap;
    calculateGridLayout(numButtons, cols, rows, cardWidth, cardHeight, gap);

    // Calculate starting position to center the grid
    int totalWidth = cols * cardWidth + (cols - 1) * gap;
    int startX = (SCREEN_WIDTH - totalWidth) / 2;
    int startY = 90;

    Serial.printf("UIManager: Grid %dx%d, card %dx%d, gap %d, startX %d\n",
                  cols, rows, cardWidth, cardHeight, gap, startX);

    for (int i = 0; i < numButtons && i < MAX_BUTTONS; i++) {
        int col = i % cols;
        int row = i / cols;
        int x = startX + col * (cardWidth + gap);
        int y = startY + row * (cardHeight + gap);

        createButtonCard(i, config.buttons[i], x, y);
    }
}

void UIManager::createButtonCard(int index, const ButtonConfig& btnConfig, int gridX, int gridY) {
    const ThemeDefinition& theme = themeEngine.getCurrentTheme();

    UIButtonCard& card = buttonCards[index];
    card.buttonId = btnConfig.id;
    card.currentState = btnConfig.state;
    card.speedSteps = btnConfig.speedSteps;
    card.speedLevel = btnConfig.speedLevel;
    card.isSceneButton = (btnConfig.type == ButtonType::SCENE);
    card.sceneId = btnConfig.sceneId;

    // Calculate card size
    int cols, rows, cardWidth, cardHeight, gap;
    calculateGridLayout(numButtons, cols, rows, cardWidth, cardHeight, gap);

    Serial.printf("UIManager: Creating card %d '%s' at (%d, %d) size %dx%d\n",
                  index, btnConfig.name.c_str(), gridX, gridY, cardWidth, cardHeight);

    // Create card container
    card.card = lv_obj_create(screen);
    lv_obj_clear_flag(card.card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(card.card, cardWidth, cardHeight);
    lv_obj_set_pos(card.card, gridX, gridY);

    // Apply theme styling
    themeEngine.styleCard(card.card, card.currentState, index);

    // Make card clickable
    lv_obj_add_flag(card.card, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(card.card, onCardClicked, LV_EVENT_CLICKED, (void*)(intptr_t)index);

    if (themeEngine.isCyberpunk()) {
        // Cyberpunk style: centered icon, uppercase name, ONLINE/OFFLINE status
        lv_color_t cardNeonColor = theme.colors.neonColors[index % 6];

        // Add corner accent decorations (top-left and bottom-right)
        lv_obj_t* cornerTL = lv_obj_create(card.card);
        lv_obj_clear_flag(cornerTL, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(cornerTL, 12, 2);
        lv_obj_set_pos(cornerTL, 4, 4);
        lv_obj_set_style_bg_color(cornerTL, cardNeonColor, 0);
        lv_obj_set_style_bg_opa(cornerTL, LV_OPA_80, 0);
        lv_obj_set_style_border_width(cornerTL, 0, 0);

        lv_obj_t* cornerTL2 = lv_obj_create(card.card);
        lv_obj_clear_flag(cornerTL2, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(cornerTL2, 2, 12);
        lv_obj_set_pos(cornerTL2, 4, 4);
        lv_obj_set_style_bg_color(cornerTL2, cardNeonColor, 0);
        lv_obj_set_style_bg_opa(cornerTL2, LV_OPA_80, 0);
        lv_obj_set_style_border_width(cornerTL2, 0, 0);

        lv_obj_t* cornerBR = lv_obj_create(card.card);
        lv_obj_clear_flag(cornerBR, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(cornerBR, 12, 2);
        lv_obj_set_pos(cornerBR, cardWidth - 16, cardHeight - 6);
        lv_obj_set_style_bg_color(cornerBR, cardNeonColor, 0);
        lv_obj_set_style_bg_opa(cornerBR, LV_OPA_80, 0);
        lv_obj_set_style_border_width(cornerBR, 0, 0);

        lv_obj_t* cornerBR2 = lv_obj_create(card.card);
        lv_obj_clear_flag(cornerBR2, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(cornerBR2, 2, 12);
        lv_obj_set_pos(cornerBR2, cardWidth - 6, cardHeight - 16);
        lv_obj_set_style_bg_color(cornerBR2, cardNeonColor, 0);
        lv_obj_set_style_bg_opa(cornerBR2, LV_OPA_80, 0);
        lv_obj_set_style_border_width(cornerBR2, 0, 0);

        // Large centered icon at top - use image for fans and custom icons, symbols for others
        if (btnConfig.type == ButtonType::FAN) {
            card.icon = lv_img_create(card.card);
            lv_img_set_src(card.icon, &fan_icon);
            lv_obj_set_style_img_recolor(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
            lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_MID, 0, 15);
            card.iconIsImage = true;
        } else if (isImageIcon(btnConfig.icon)) {
            // Use custom image icon
            card.icon = lv_img_create(card.card);
            lv_img_set_src(card.icon, getIconImage(btnConfig.icon));
            lv_color_t iconColor = (btnConfig.type == ButtonType::SCENE) ? cardNeonColor : themeEngine.getIconColor(card.currentState, index);
            lv_obj_set_style_img_recolor(card.icon, iconColor, 0);
            lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_MID, 0, 15);
            card.iconIsImage = true;
        } else {
            // Use text symbol
            card.icon = lv_label_create(card.card);
            const char* iconSymbol = getIconSymbol(btnConfig.icon);
            lv_label_set_text(card.icon, iconSymbol);
            lv_obj_set_style_text_font(card.icon, &lv_font_montserrat_28, 0);
            lv_color_t iconColor = (btnConfig.type == ButtonType::SCENE) ? cardNeonColor : themeEngine.getIconColor(card.currentState, index);
            lv_obj_set_style_text_color(card.icon, iconColor, 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_MID, 0, 15);
            card.iconIsImage = false;
        }

        // Uppercase room name, centered
        card.nameLabel = lv_label_create(card.card);
        String upperName = btnConfig.name;
        upperName.toUpperCase();
        lv_label_set_text(card.nameLabel, upperName.c_str());
        lv_obj_set_style_text_font(card.nameLabel, &lv_font_montserrat_16, 0);
        themeEngine.styleLabel(card.nameLabel, true);
        lv_obj_align(card.nameLabel, LV_ALIGN_CENTER, 0, 10);

        // Status text: [ONLINE] / [OFFLINE] - scene buttons don't show status
        card.stateLabel = lv_label_create(card.card);
        if (btnConfig.type == ButtonType::SCENE) {
            lv_label_set_text(card.stateLabel, "");  // No status text for scene buttons
        } else {
            lv_label_set_text(card.stateLabel, card.currentState ? "[ONLINE]" : "[OFFLINE]");
        }
        lv_obj_set_style_text_font(card.stateLabel, &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_color(card.stateLabel, themeEngine.getIconColor(card.currentState, index), 0);
        lv_obj_align(card.stateLabel, LV_ALIGN_BOTTOM_MID, 0, -10);

        // No toggle switch for cyberpunk
        card.toggle = nullptr;
    } else {
        // Standard style with toggle switch (except for scene buttons)
        // Icon - use image for fans and custom icons, symbols for others
        if (btnConfig.type == ButtonType::FAN) {
            card.icon = lv_img_create(card.card);
            lv_img_set_src(card.icon, &fan_icon);
            lv_obj_set_style_img_recolor(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
            lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_LEFT, 18, 18);
            card.iconIsImage = true;
        } else if (isImageIcon(btnConfig.icon)) {
            // Use custom image icon
            card.icon = lv_img_create(card.card);
            lv_img_set_src(card.icon, getIconImage(btnConfig.icon));
            lv_obj_set_style_img_recolor(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
            lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_LEFT, 18, 18);
            card.iconIsImage = true;
        } else {
            // Use text symbol
            card.icon = lv_label_create(card.card);
            const char* iconSymbol = getIconSymbol(btnConfig.icon);
            lv_label_set_text(card.icon, iconSymbol);
            lv_obj_set_style_text_font(card.icon, &lv_font_montserrat_28, 0);
            lv_obj_set_style_text_color(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
            lv_obj_align(card.icon, LV_ALIGN_TOP_LEFT, 18, 18);
            card.iconIsImage = false;
        }

        // Toggle switch (not for scene buttons)
        if (btnConfig.type == ButtonType::SCENE) {
            card.toggle = nullptr;
            // No toggle or label for scene buttons - they're just tappable
        } else {
            card.toggle = lv_switch_create(card.card);
            lv_obj_set_size(card.toggle, 50, 26);
            lv_obj_align(card.toggle, LV_ALIGN_TOP_RIGHT, -15, 18);
            themeEngine.styleSwitch(card.toggle);

            if (card.currentState) {
                lv_obj_add_state(card.toggle, LV_STATE_CHECKED);
            }

            lv_obj_add_event_cb(card.toggle, onToggleChanged, LV_EVENT_VALUE_CHANGED, (void*)(intptr_t)index);
        }

        // Room name label
        card.nameLabel = lv_label_create(card.card);
        lv_label_set_text(card.nameLabel, btnConfig.name.c_str());
        lv_obj_set_style_text_font(card.nameLabel, &lv_font_montserrat_16, 0);
        themeEngine.styleLabel(card.nameLabel, true);
        lv_obj_align(card.nameLabel, LV_ALIGN_BOTTOM_LEFT, 18, -18);

        // Status text (for themes that show it)
        if (themeEngine.showsStatusText()) {
            card.stateLabel = lv_label_create(card.card);
            if (btnConfig.type == ButtonType::SCENE) {
                lv_label_set_text(card.stateLabel, "Tap to run");
            } else {
                lv_label_set_text(card.stateLabel, themeEngine.getStateText(card.currentState));
            }
            lv_obj_set_style_text_font(card.stateLabel, &lv_font_montserrat_14, 0);
            lv_obj_set_style_text_color(card.stateLabel, themeEngine.getIconColor(card.currentState, index), 0);
            lv_obj_align(card.stateLabel, LV_ALIGN_BOTTOM_RIGHT, -15, -18);
        } else {
            card.stateLabel = nullptr;
        }
    }
}

void UIManager::createActionBar() {
    const DeviceConfig& config = configManager.getConfig();

    if (numScenes == 0) return;

    actionBar = lv_obj_create(screen);
    lv_obj_set_layout(actionBar, 0);
    lv_obj_clear_flag(actionBar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(actionBar, 420, 60);
    lv_obj_set_pos(actionBar, 30, 360);
    themeEngine.styleActionBar(actionBar);

    Serial.printf("UIManager: Created action bar at (30, 360) size 420x60\n");

    // Create scene buttons
    for (int i = 0; i < numScenes && i < MAX_SCENES; i++) {
        bool isLeft = (i == 0);
        createSceneButton(i, config.scenes[i], isLeft);
    }
}

void UIManager::createSceneButton(int index, const SceneConfig& scnConfig, bool isLeft) {
    const ThemeDefinition& theme = themeEngine.getCurrentTheme();

    UISceneButton& scene = sceneButtons[index];
    scene.sceneId = scnConfig.id;

    scene.button = lv_btn_create(actionBar);

    // Size depends on how many scenes
    int btnWidth = (numScenes == 1) ? 390 : 190;
    lv_obj_set_size(scene.button, btnWidth, 44);

    if (numScenes == 1) {
        lv_obj_align(scene.button, LV_ALIGN_CENTER, 0, 0);
    } else if (isLeft) {
        lv_obj_align(scene.button, LV_ALIGN_LEFT_MID, 8, 0);
    } else {
        lv_obj_align(scene.button, LV_ALIGN_RIGHT_MID, -8, 0);
    }

    bool isPrimary = !isLeft;

    if (themeEngine.isCyberpunk()) {
        // Cyberpunk style: outlined buttons with bracketed text
        lv_obj_set_style_bg_opa(scene.button, LV_OPA_TRANSP, 0);  // Transparent background
        lv_obj_set_style_border_width(scene.button, 2, 0);
        lv_obj_set_style_radius(scene.button, theme.style.buttonRadius, 0);

        // Color based on primary/secondary
        lv_color_t borderColor = isPrimary ? lv_color_hex(0x00ff88) : lv_color_hex(0xff0080);  // Green / Pink
        lv_obj_set_style_border_color(scene.button, borderColor, 0);

        // Bracketed uppercase text
        scene.label = lv_label_create(scene.button);
        String upperName = scnConfig.name;
        upperName.toUpperCase();
        String labelText = "[ " + upperName + " ]";
        lv_label_set_text(scene.label, labelText.c_str());
        lv_obj_set_style_text_color(scene.label, borderColor, 0);
        lv_obj_center(scene.label);
    } else {
        // Standard style
        themeEngine.styleButton(scene.button, isPrimary);

        // For image-based icons, create an image + label side by side
        // For symbol icons, use a single label with icon + text
        if (isImageIcon(scnConfig.icon)) {
            // Create a horizontal container for image + text
            lv_obj_t* iconImg = lv_img_create(scene.button);
            lv_img_set_src(iconImg, getIconImage(scnConfig.icon));
            lv_obj_set_style_img_recolor(iconImg, isPrimary ? lv_color_white() : theme.colors.textPrimary, 0);
            lv_obj_set_style_img_recolor_opa(iconImg, LV_OPA_COVER, 0);
            lv_obj_align(iconImg, LV_ALIGN_LEFT_MID, 15, 0);

            scene.label = lv_label_create(scene.button);
            lv_label_set_text(scene.label, scnConfig.name.c_str());
            lv_obj_set_style_text_color(scene.label, isPrimary ? lv_color_white() : theme.colors.textPrimary, 0);
            lv_obj_align(scene.label, LV_ALIGN_LEFT_MID, 55, 0);  // Offset for icon
        } else {
            // Label with symbol icon and text
            scene.label = lv_label_create(scene.button);
            String labelText = String(getIconSymbol(scnConfig.icon)) + " " + scnConfig.name;
            lv_label_set_text(scene.label, labelText.c_str());
            // Use white text on primary (accent) buttons, dark text on secondary buttons
            lv_obj_set_style_text_color(scene.label, isPrimary ? lv_color_white() : theme.colors.textPrimary, 0);
            lv_obj_center(scene.label);
        }
    }

    lv_obj_add_event_cb(scene.button, onSceneClicked, LV_EVENT_CLICKED, (void*)(intptr_t)index);
}

// ============================================================================
// CYBERPUNK DECORATIONS
// ============================================================================

void UIManager::createCyberpunkDecorations() {
    lv_color_t neonCyan = lv_color_hex(0x00d4ff);
    lv_color_t neonPink = lv_color_hex(0xff0080);
    lv_color_t neonGreen = lv_color_hex(0x00ff88);
    lv_color_t gridColor = lv_color_hex(0x00d4ff);

    // === Background grid lines (subtle tech grid) ===
    // Vertical grid lines
    for (int x = 60; x < SCREEN_WIDTH; x += 80) {
        lv_obj_t* vLine = lv_obj_create(screen);
        lv_obj_clear_flag(vLine, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_size(vLine, 1, SCREEN_HEIGHT);
        lv_obj_set_pos(vLine, x, 0);
        lv_obj_set_style_bg_color(vLine, gridColor, 0);
        lv_obj_set_style_bg_opa(vLine, LV_OPA_10, 0);
        lv_obj_set_style_border_width(vLine, 0, 0);
        lv_obj_move_to_index(vLine, 0);  // Send to back
    }

    // Horizontal grid lines
    for (int y = 80; y < SCREEN_HEIGHT; y += 80) {
        lv_obj_t* hLine = lv_obj_create(screen);
        lv_obj_clear_flag(hLine, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_size(hLine, SCREEN_WIDTH, 1);
        lv_obj_set_pos(hLine, 0, y);
        lv_obj_set_style_bg_color(hLine, gridColor, 0);
        lv_obj_set_style_bg_opa(hLine, LV_OPA_10, 0);
        lv_obj_set_style_border_width(hLine, 0, 0);
        lv_obj_move_to_index(hLine, 0);  // Send to back
    }

    // === Bottom data ticker bar ===
    lv_obj_t* dataBar = lv_obj_create(screen);
    lv_obj_clear_flag(dataBar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(dataBar, SCREEN_WIDTH, 30);
    lv_obj_set_pos(dataBar, 0, SCREEN_HEIGHT - 30);
    lv_obj_set_style_bg_color(dataBar, lv_color_hex(0x0a0a0a), 0);
    lv_obj_set_style_bg_opa(dataBar, LV_OPA_90, 0);
    lv_obj_set_style_border_width(dataBar, 0, 0);
    lv_obj_set_style_border_side(dataBar, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_color(dataBar, neonCyan, 0);
    lv_obj_set_style_border_opa(dataBar, LV_OPA_50, 0);

    // Top border glow line
    lv_obj_t* glowLine = lv_obj_create(screen);
    lv_obj_clear_flag(glowLine, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(glowLine, SCREEN_WIDTH, 1);
    lv_obj_set_pos(glowLine, 0, SCREEN_HEIGHT - 30);
    lv_obj_set_style_bg_color(glowLine, neonCyan, 0);
    lv_obj_set_style_bg_opa(glowLine, LV_OPA_60, 0);
    lv_obj_set_style_border_width(glowLine, 0, 0);
    lv_obj_set_style_shadow_width(glowLine, 6, 0);
    lv_obj_set_style_shadow_color(glowLine, neonCyan, 0);
    lv_obj_set_style_shadow_opa(glowLine, LV_OPA_50, 0);

    // Device IP address display
    lv_obj_t* ipLabel = lv_label_create(dataBar);
    String ipText = "IP::" + WiFi.localIP().toString();
    lv_label_set_text(ipLabel, ipText.c_str());
    lv_obj_set_style_text_font(ipLabel, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(ipLabel, neonCyan, 0);
    lv_obj_align(ipLabel, LV_ALIGN_LEFT_MID, 15, 0);

    // Right side: blinking cursor effect (static) and hex data
    lv_obj_t* hexData = lv_label_create(dataBar);
    lv_label_set_text(hexData, "0xC0DE::RDY");
    lv_obj_set_style_text_font(hexData, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(hexData, neonPink, 0);
    lv_obj_align(hexData, LV_ALIGN_RIGHT_MID, -15, 0);

    // === Diagonal accent lines in corners ===
    // Top-right corner diagonal
    lv_obj_t* diagTR = lv_obj_create(screen);
    lv_obj_clear_flag(diagTR, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(diagTR, 40, 2);
    lv_obj_set_pos(diagTR, SCREEN_WIDTH - 55, 75);
    lv_obj_set_style_bg_color(diagTR, neonPink, 0);
    lv_obj_set_style_bg_opa(diagTR, LV_OPA_60, 0);
    lv_obj_set_style_border_width(diagTR, 0, 0);
    lv_obj_set_style_transform_angle(diagTR, 450, 0);  // 45 degrees (in 0.1 deg units)

    // Bottom-left corner diagonal
    lv_obj_t* diagBL = lv_obj_create(screen);
    lv_obj_clear_flag(diagBL, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(diagBL, 40, 2);
    lv_obj_set_pos(diagBL, 15, 340);
    lv_obj_set_style_bg_color(diagBL, neonCyan, 0);
    lv_obj_set_style_bg_opa(diagBL, LV_OPA_60, 0);
    lv_obj_set_style_border_width(diagBL, 0, 0);
    lv_obj_set_style_transform_angle(diagBL, -450, 0);  // -45 degrees

    // === Small accent dots ===
    // Add some small glowing dots at strategic positions
    int dotPositions[][2] = {{SCREEN_WIDTH - 20, 80}, {20, 330}, {SCREEN_WIDTH - 25, 330}};
    lv_color_t dotColors[] = {neonPink, neonCyan, neonGreen};

    for (int i = 0; i < 3; i++) {
        lv_obj_t* dot = lv_obj_create(screen);
        lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_size(dot, 4, 4);
        lv_obj_set_pos(dot, dotPositions[i][0], dotPositions[i][1]);
        lv_obj_set_style_bg_color(dot, dotColors[i], 0);
        lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(dot, 0, 0);
        lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_shadow_width(dot, 8, 0);
        lv_obj_set_style_shadow_color(dot, dotColors[i], 0);
        lv_obj_set_style_shadow_opa(dot, LV_OPA_70, 0);
    }

    Serial.println("UIManager: Created Cyberpunk decorations");
}

// ============================================================================
// LCARS-SPECIFIC LAYOUT
// ============================================================================

void UIManager::createLCARSLayout() {
    const DeviceConfig& config = configManager.getConfig();

    // LCARS Colors
    lv_color_t lcarsOrange = lv_color_hex(0xcc6600);
    lv_color_t lcarsTan = lv_color_hex(0xffcc99);
    lv_color_t lcarsBlue = lv_color_hex(0x6688cc);
    lv_color_t lcarsPurpleActive = lv_color_hex(0x664477);
    lv_color_t lcarsPurpleStandby = lv_color_hex(0x9977aa);
    lv_color_t lcarsYellow = lv_color_hex(0xffcc66);

    // === LEFT SIDEBAR with curved bottom (characteristic LCARS elbow) ===
    // Sidebar - main vertical bar
    lv_obj_t* sidebar = lv_obj_create(screen);
    lv_obj_clear_flag(sidebar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(sidebar, 50, 380);
    lv_obj_set_pos(sidebar, 0, 0);
    lv_obj_set_style_bg_color(sidebar, lcarsOrange, 0);
    lv_obj_set_style_bg_opa(sidebar, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(sidebar, 0, 0);
    lv_obj_set_style_border_width(sidebar, 0, 0);

    // LCARS elbow curve image (100x100 pixels)
    lv_obj_t* elbowImg = lv_img_create(screen);
    lv_img_set_src(elbowImg, &lcars_elbow_img);
    lv_obj_set_pos(elbowImg, 0, 380);  // Bottom edge at 480

    // Bottom horizontal bar - connects to elbow, aligned with bottom of screen
    lv_obj_t* bottomBar = lv_obj_create(screen);
    lv_obj_clear_flag(bottomBar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(bottomBar, 430, 50);  // Taller to match elbow height at bottom
    lv_obj_set_pos(bottomBar, 50, 430);   // Starts where elbow's horizontal begins
    lv_obj_set_style_bg_color(bottomBar, lcarsOrange, 0);
    lv_obj_set_style_bg_opa(bottomBar, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(bottomBar, 0, 0);
    lv_obj_set_style_border_width(bottomBar, 0, 0);

    // Sidebar numbers
    lv_obj_t* num01 = lv_label_create(sidebar);
    lv_label_set_text(num01, "01");
    lv_obj_set_style_text_color(num01, lv_color_black(), 0);
    lv_obj_set_style_text_font(num01, &lv_font_montserrat_14, 0);
    lv_obj_align(num01, LV_ALIGN_TOP_MID, 0, 15);

    lv_obj_t* num07 = lv_label_create(sidebar);
    lv_label_set_text(num07, "07");
    lv_obj_set_style_text_color(num07, lv_color_black(), 0);
    lv_obj_set_style_text_font(num07, &lv_font_montserrat_14, 0);
    lv_obj_align(num07, LV_ALIGN_CENTER, 0, 0);

    lv_obj_t* num42 = lv_label_create(sidebar);
    lv_label_set_text(num42, "42");
    lv_obj_set_style_text_color(num42, lv_color_black(), 0);
    lv_obj_set_style_text_font(num42, &lv_font_montserrat_14, 0);
    lv_obj_align(num42, LV_ALIGN_BOTTOM_MID, 0, -15);

    // === TOP HEADER BAR ===
    // "LCARS" title box
    lv_obj_t* lcarsBox = lv_obj_create(screen);
    lv_obj_clear_flag(lcarsBox, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(lcarsBox, 180, 35);
    lv_obj_set_pos(lcarsBox, 55, 8);
    lv_obj_set_style_bg_color(lcarsBox, lcarsOrange, 0);
    lv_obj_set_style_bg_opa(lcarsBox, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(lcarsBox, 18, 0);
    lv_obj_set_style_border_width(lcarsBox, 0, 0);

    lv_obj_t* lcarsTitle = lv_label_create(lcarsBox);
    lv_label_set_text(lcarsTitle, "LCARS");
    lv_obj_set_style_text_color(lcarsTitle, lv_color_black(), 0);
    lv_obj_set_style_text_font(lcarsTitle, &lv_font_montserrat_20, 0);
    lv_obj_center(lcarsTitle);

    // Horizontal line under LCARS
    lv_obj_t* hline1 = lv_obj_create(screen);
    lv_obj_clear_flag(hline1, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(hline1, 140, 4);
    lv_obj_set_pos(hline1, 240, 23);
    lv_obj_set_style_bg_color(hline1, lcarsOrange, 0);
    lv_obj_set_style_bg_opa(hline1, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(hline1, 0, 0);
    lv_obj_set_style_border_width(hline1, 0, 0);

    // "HOME CTRL" box
    lv_obj_t* homeCtrlBox = lv_obj_create(screen);
    lv_obj_clear_flag(homeCtrlBox, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(homeCtrlBox, 95, 28);
    lv_obj_set_pos(homeCtrlBox, 330, 10);
    lv_obj_set_style_bg_color(homeCtrlBox, lcarsTan, 0);
    lv_obj_set_style_bg_opa(homeCtrlBox, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(homeCtrlBox, 14, 0);
    lv_obj_set_style_border_width(homeCtrlBox, 0, 0);
    lv_obj_set_style_pad_all(homeCtrlBox, 0, 0);

    lv_obj_t* homeCtrlLabel = lv_label_create(homeCtrlBox);
    lv_label_set_text(homeCtrlLabel, "HOME CTRL");
    lv_obj_set_style_text_color(homeCtrlLabel, lv_color_black(), 0);
    lv_obj_set_style_text_font(homeCtrlLabel, &lv_font_montserrat_14, 0);
    lv_obj_center(homeCtrlLabel);

    // Blue accent
    lv_obj_t* blueAccent = lv_obj_create(screen);
    lv_obj_clear_flag(blueAccent, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(blueAccent, 50, 28);
    lv_obj_set_pos(blueAccent, 425, 10);
    lv_obj_set_style_bg_color(blueAccent, lcarsBlue, 0);
    lv_obj_set_style_bg_opa(blueAccent, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(blueAccent, 14, 0);
    lv_obj_set_style_border_width(blueAccent, 0, 0);

    // === "ILLUMINATION CONTROL" SECTION ===
    lv_obj_t* sectionTitle = lv_label_create(screen);
    lv_label_set_text(sectionTitle, "ILLUMINATION CONTROL");
    lv_obj_set_style_text_color(sectionTitle, lcarsOrange, 0);
    lv_obj_set_style_text_font(sectionTitle, &lv_font_montserrat_20, 0);
    lv_obj_set_pos(sectionTitle, 70, 50);

    // Horizontal line under section title
    lv_obj_t* hline2 = lv_obj_create(screen);
    lv_obj_clear_flag(hline2, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(hline2, 400, 2);
    lv_obj_set_pos(hline2, 70, 75);
    lv_obj_set_style_bg_color(hline2, lcarsOrange, 0);
    lv_obj_set_style_bg_opa(hline2, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(hline2, 0, 0);
    lv_obj_set_style_border_width(hline2, 0, 0);

    // === BUTTON CARDS (2 columns, variable rows) ===
    int cardStartX = 70;
    int cardStartY = 90;
    int cardGap = 8;
    int cols = 2;  // Always 2 columns for readability
    int rows = (numButtons + cols - 1) / cols;  // Calculate actual rows needed

    // Adjust card height based on available space (leave room for status section)
    // Available height: from cardStartY (90) to bottom bar area (~300 for status)
    int availableHeight = 210;  // Space for cards before status section
    int cardHeight = (availableHeight - (rows - 1) * cardGap) / rows;
    if (cardHeight > 95) cardHeight = 95;  // Max height
    if (cardHeight < 50) cardHeight = 50;  // Min height
    int cardWidth = 195;

    for (int i = 0; i < numButtons && i < MAX_BUTTONS; i++) {
        int col = i % cols;
        int row = i / cols;
        int x = cardStartX + col * (cardWidth + cardGap);
        int y = cardStartY + row * (cardHeight + cardGap);
        createLCARSCard(i, config.buttons[i], x, y, cardWidth, cardHeight);
    }

    // === SYSTEM STATUS SECTION ===
    int statusY = cardStartY + rows * (cardHeight + cardGap) + 5;

    lv_obj_t* statusTitle = lv_label_create(screen);
    lv_label_set_text(statusTitle, "SYSTEM STATUS");
    lv_obj_set_style_text_color(statusTitle, lcarsTan, 0);
    lv_obj_set_style_text_font(statusTitle, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(statusTitle, 70, statusY);

    // Count active systems
    int activeCount = 0;
    for (int i = 0; i < numButtons; i++) {
        if (config.buttons[i].state) activeCount++;
    }

    // Active count box
    lv_obj_t* countBox = lv_obj_create(screen);
    lv_obj_clear_flag(countBox, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(countBox, 45, 45);
    lv_obj_set_pos(countBox, 70, statusY + 22);
    lv_obj_set_style_bg_color(countBox, lcarsTan, 0);
    lv_obj_set_style_bg_opa(countBox, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(countBox, 8, 0);
    lv_obj_set_style_border_width(countBox, 0, 0);

    lv_obj_t* countLabel = lv_label_create(countBox);
    lv_label_set_text_fmt(countLabel, "%d", activeCount);
    lv_obj_set_style_text_color(countLabel, lv_color_black(), 0);
    lv_obj_set_style_text_font(countLabel, &lv_font_montserrat_24, 0);
    lv_obj_center(countLabel);

    lv_obj_t* activeLabel = lv_label_create(screen);
    lv_label_set_text(activeLabel, "ACTIVE\nSYSTEMS");
    lv_obj_set_style_text_color(activeLabel, lcarsTan, 0);
    lv_obj_set_style_text_font(activeLabel, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(activeLabel, 120, statusY + 28);

    // === SCENE BUTTONS ===
    if (numScenes > 0) {
        int sceneY = statusY + 20;
        int sceneX = 230;

        for (int i = 0; i < numScenes && i < MAX_SCENES; i++) {
            UISceneButton& scene = sceneButtons[i];
            scene.sceneId = config.scenes[i].id;

            scene.button = lv_btn_create(screen);
            lv_obj_set_size(scene.button, 130, 35);
            lv_obj_set_pos(scene.button, sceneX, sceneY + i * 42);
            lv_obj_set_style_bg_color(scene.button, lcarsTan, 0);
            lv_obj_set_style_bg_opa(scene.button, LV_OPA_COVER, 0);
            lv_obj_set_style_radius(scene.button, 18, 0);
            lv_obj_set_style_shadow_width(scene.button, 0, 0);

            scene.label = lv_label_create(scene.button);
            String upperName = config.scenes[i].name;
            upperName.toUpperCase();
            lv_label_set_text(scene.label, upperName.c_str());
            lv_obj_set_style_text_color(scene.label, lv_color_black(), 0);
            lv_obj_set_style_text_font(scene.label, &lv_font_montserrat_14, 0);
            lv_obj_center(scene.label);

            lv_obj_add_event_cb(scene.button, onSceneClicked, LV_EVENT_CLICKED, (void*)(intptr_t)i);
        }
    }

    // === BOTTOM FOOTER (integrated with the curved bar) ===
    // Stardate box (sits on the bottom bar)
    lv_obj_t* stardateBox = lv_obj_create(screen);
    lv_obj_clear_flag(stardateBox, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(stardateBox, 85, 30);
    lv_obj_set_pos(stardateBox, 130, 445);
    lv_obj_set_style_bg_color(stardateBox, lcarsTan, 0);
    lv_obj_set_style_bg_opa(stardateBox, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(stardateBox, 12, 0);
    lv_obj_set_style_border_width(stardateBox, 0, 0);

    lv_obj_t* stardateLabel = lv_label_create(stardateBox);
    lv_label_set_text(stardateLabel, "47634.8");
    lv_obj_set_style_text_color(stardateLabel, lv_color_black(), 0);
    lv_obj_set_style_text_font(stardateLabel, &lv_font_montserrat_14, 0);
    lv_obj_center(stardateLabel);

    // Deck/Section box
    lv_obj_t* deckBox = lv_obj_create(screen);
    lv_obj_clear_flag(deckBox, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(deckBox, 145, 30);
    lv_obj_set_pos(deckBox, 330, 445);
    lv_obj_set_style_bg_color(deckBox, lcarsTan, 0);
    lv_obj_set_style_bg_opa(deckBox, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(deckBox, 12, 0);
    lv_obj_set_style_border_width(deckBox, 0, 0);

    lv_obj_t* deckLabel = lv_label_create(deckBox);
    lv_label_set_text(deckLabel, "DECK 7 SECTION 4");
    lv_obj_set_style_text_color(deckLabel, lv_color_black(), 0);
    lv_obj_set_style_text_font(deckLabel, &lv_font_montserrat_14, 0);
    lv_obj_center(deckLabel);

    // Create fan overlay for LCARS theme
    createFanOverlay();

    Serial.println("UIManager: LCARS layout created");
}

// ============================================================================
// FAN SPEED OVERLAY
// ============================================================================

void UIManager::createFanOverlay() {
    // Initialize overlay state
    fanOverlay.visible = false;
    fanOverlay.cardIndex = -1;

    // LCARS theme colors
    bool isLCARS = themeEngine.isLCARS();
    lv_color_t lcarsOrange = lv_color_hex(0xcc6600);
    lv_color_t lcarsTan = lv_color_hex(0xffcc99);
    lv_color_t lcarsBlue = lv_color_hex(0x6688cc);
    lv_color_t lcarsPurple = lv_color_hex(0x9977aa);

    // Create semi-transparent background overlay
    fanOverlay.overlay = lv_obj_create(screen);
    lv_obj_set_size(fanOverlay.overlay, SCREEN_WIDTH, SCREEN_HEIGHT);
    lv_obj_set_pos(fanOverlay.overlay, 0, 0);
    lv_obj_set_style_bg_color(fanOverlay.overlay, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(fanOverlay.overlay, LV_OPA_80, 0);
    lv_obj_set_style_border_width(fanOverlay.overlay, 0, 0);
    lv_obj_clear_flag(fanOverlay.overlay, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(fanOverlay.overlay, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(fanOverlay.overlay, onFanOverlayClose, LV_EVENT_CLICKED, nullptr);

    // Create the main panel - compact size
    fanOverlay.panel = lv_obj_create(fanOverlay.overlay);
    lv_obj_set_size(fanOverlay.panel, 240, 340);
    lv_obj_center(fanOverlay.panel);
    lv_obj_clear_flag(fanOverlay.panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(fanOverlay.panel, LV_OBJ_FLAG_CLICKABLE);

    if (isLCARS) {
        // LCARS terminal style - black background with orange frame
        lv_obj_set_style_bg_color(fanOverlay.panel, lv_color_black(), 0);
        lv_obj_set_style_bg_opa(fanOverlay.panel, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(fanOverlay.panel, 20, 0);
        lv_obj_set_style_border_width(fanOverlay.panel, 4, 0);
        lv_obj_set_style_border_color(fanOverlay.panel, lcarsOrange, 0);
        lv_obj_set_style_shadow_width(fanOverlay.panel, 0, 0);
    } else {
        // Standard frosted glass style
        lv_obj_set_style_bg_color(fanOverlay.panel, lv_color_hex(0x2c2c2e), 0);
        lv_obj_set_style_bg_opa(fanOverlay.panel, LV_OPA_90, 0);
        lv_obj_set_style_radius(fanOverlay.panel, 30, 0);
        lv_obj_set_style_border_width(fanOverlay.panel, 1, 0);
        lv_obj_set_style_border_color(fanOverlay.panel, lv_color_hex(0x48484a), 0);
        lv_obj_set_style_shadow_width(fanOverlay.panel, 30, 0);
        lv_obj_set_style_shadow_color(fanOverlay.panel, lv_color_black(), 0);
        lv_obj_set_style_shadow_opa(fanOverlay.panel, LV_OPA_50, 0);
    }

    // LCARS header bar (only for LCARS theme)
    if (isLCARS) {
        lv_obj_t* headerBar = lv_obj_create(fanOverlay.panel);
        lv_obj_clear_flag(headerBar, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_size(headerBar, 220, 30);
        lv_obj_align(headerBar, LV_ALIGN_TOP_MID, 0, 8);
        lv_obj_set_style_bg_color(headerBar, lcarsOrange, 0);
        lv_obj_set_style_bg_opa(headerBar, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(headerBar, 18, 0);
        lv_obj_set_style_border_width(headerBar, 0, 0);

        lv_obj_t* headerLabel = lv_label_create(headerBar);
        lv_label_set_text(headerLabel, "ENVIRONMENTAL CTRL");
        lv_obj_set_style_text_color(headerLabel, lv_color_black(), 0);
        lv_obj_set_style_text_font(headerLabel, &lv_font_montserrat_14, 0);
        lv_obj_center(headerLabel);
    }

    // Title label (fan name)
    fanOverlay.titleLabel = lv_label_create(fanOverlay.panel);
    lv_label_set_text(fanOverlay.titleLabel, "Fan");
    lv_obj_set_style_text_font(fanOverlay.titleLabel, &lv_font_montserrat_20, 0);
    if (isLCARS) {
        lv_obj_set_style_text_color(fanOverlay.titleLabel, lcarsOrange, 0);
        lv_obj_align(fanOverlay.titleLabel, LV_ALIGN_TOP_MID, 0, 45);
    } else {
        lv_obj_set_style_text_color(fanOverlay.titleLabel, lv_color_white(), 0);
        lv_obj_align(fanOverlay.titleLabel, LV_ALIGN_TOP_MID, 0, 15);
    }

    // Status label
    fanOverlay.statusLabel = lv_label_create(fanOverlay.panel);
    lv_label_set_text(fanOverlay.statusLabel, "Off");
    lv_obj_set_style_text_font(fanOverlay.statusLabel, &lv_font_montserrat_14, 0);
    if (isLCARS) {
        lv_obj_set_style_text_color(fanOverlay.statusLabel, lcarsTan, 0);
        lv_obj_align(fanOverlay.statusLabel, LV_ALIGN_TOP_MID, 0, 70);
    } else {
        lv_obj_set_style_text_color(fanOverlay.statusLabel, lv_color_hex(0x98989d), 0);
        lv_obj_align(fanOverlay.statusLabel, LV_ALIGN_TOP_MID, 0, 38);
    }

    // Create the vertical slider track background
    fanOverlay.sliderTrack = lv_obj_create(fanOverlay.panel);
    lv_obj_set_size(fanOverlay.sliderTrack, 70, 150);
    lv_obj_align(fanOverlay.sliderTrack, LV_ALIGN_CENTER, 0, isLCARS ? 5 : -5);
    lv_obj_clear_flag(fanOverlay.sliderTrack, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_border_width(fanOverlay.sliderTrack, 0, 0);

    if (isLCARS) {
        lv_obj_set_style_bg_color(fanOverlay.sliderTrack, lv_color_hex(0x1a1a1a), 0);
        lv_obj_set_style_bg_opa(fanOverlay.sliderTrack, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(fanOverlay.sliderTrack, 10, 0);
    } else {
        lv_obj_set_style_bg_color(fanOverlay.sliderTrack, lv_color_hex(0x48484a), 0);
        lv_obj_set_style_bg_opa(fanOverlay.sliderTrack, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(fanOverlay.sliderTrack, 30, 0);
    }

    // Create the vertical slider
    fanOverlay.slider = lv_slider_create(fanOverlay.panel);
    lv_obj_set_size(fanOverlay.slider, 50, 130);
    lv_obj_align(fanOverlay.slider, LV_ALIGN_CENTER, 0, isLCARS ? 5 : -5);
    lv_slider_set_range(fanOverlay.slider, 0, 3);  // Default: 0=off, 1=low, 2=med, 3=high
    lv_slider_set_value(fanOverlay.slider, 0, LV_ANIM_OFF);

    // Style the slider
    lv_obj_set_style_bg_opa(fanOverlay.slider, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(fanOverlay.slider, LV_OPA_COVER, LV_PART_INDICATOR);

    if (isLCARS) {
        // LCARS style slider
        lv_obj_set_style_bg_color(fanOverlay.slider, lv_color_hex(0x1a1a1a), LV_PART_MAIN);
        lv_obj_set_style_bg_color(fanOverlay.slider, lcarsPurple, LV_PART_INDICATOR);
        lv_obj_set_style_radius(fanOverlay.slider, 8, LV_PART_MAIN);
        lv_obj_set_style_radius(fanOverlay.slider, 8, LV_PART_INDICATOR);
        // LCARS style knob - pill shaped, smaller
        lv_obj_set_style_bg_color(fanOverlay.slider, lcarsTan, LV_PART_KNOB);
        lv_obj_set_style_bg_opa(fanOverlay.slider, LV_OPA_COVER, LV_PART_KNOB);
        lv_obj_set_style_pad_all(fanOverlay.slider, 4, LV_PART_KNOB);
        lv_obj_set_style_radius(fanOverlay.slider, 10, LV_PART_KNOB);
        lv_obj_set_style_shadow_width(fanOverlay.slider, 0, LV_PART_KNOB);
    } else {
        // Standard style slider
        lv_obj_set_style_bg_color(fanOverlay.slider, lv_color_hex(0x48484a), LV_PART_MAIN);
        lv_obj_set_style_bg_color(fanOverlay.slider, lv_color_hex(0x32d74b), LV_PART_INDICATOR);
        lv_obj_set_style_radius(fanOverlay.slider, 25, LV_PART_MAIN);
        lv_obj_set_style_radius(fanOverlay.slider, 25, LV_PART_INDICATOR);
        // Standard style knob - circular, smaller
        lv_obj_set_style_bg_color(fanOverlay.slider, lv_color_white(), LV_PART_KNOB);
        lv_obj_set_style_bg_opa(fanOverlay.slider, LV_OPA_COVER, LV_PART_KNOB);
        lv_obj_set_style_pad_all(fanOverlay.slider, 5, LV_PART_KNOB);
        lv_obj_set_style_radius(fanOverlay.slider, LV_RADIUS_CIRCLE, LV_PART_KNOB);
        lv_obj_set_style_shadow_width(fanOverlay.slider, 8, LV_PART_KNOB);
        lv_obj_set_style_shadow_color(fanOverlay.slider, lv_color_black(), LV_PART_KNOB);
        lv_obj_set_style_shadow_opa(fanOverlay.slider, LV_OPA_30, LV_PART_KNOB);
    }

    lv_obj_add_event_cb(fanOverlay.slider, onFanSliderChanged, LV_EVENT_VALUE_CHANGED, nullptr);
    lv_obj_add_event_cb(fanOverlay.slider, onFanSliderChanged, LV_EVENT_RELEASED, nullptr);

    // Fan icon below slider - use custom PNG image
    fanOverlay.fanIcon = lv_img_create(fanOverlay.panel);
    lv_img_set_src(fanOverlay.fanIcon, &fan_icon);
    if (isLCARS) {
        lv_obj_set_style_img_recolor(fanOverlay.fanIcon, lcarsPurple, 0);
        lv_obj_set_style_img_recolor_opa(fanOverlay.fanIcon, LV_OPA_COVER, 0);
        lv_obj_align(fanOverlay.fanIcon, LV_ALIGN_BOTTOM_MID, 0, -15);
    } else {
        lv_obj_set_style_img_recolor(fanOverlay.fanIcon, lv_color_hex(0x32d74b), 0);
        lv_obj_set_style_img_recolor_opa(fanOverlay.fanIcon, LV_OPA_COVER, 0);
        lv_obj_align(fanOverlay.fanIcon, LV_ALIGN_BOTTOM_MID, 0, -15);
    }

    // Close button
    fanOverlay.closeBtn = lv_btn_create(fanOverlay.panel);
    lv_obj_set_style_shadow_width(fanOverlay.closeBtn, 0, 0);
    lv_obj_add_event_cb(fanOverlay.closeBtn, onFanOverlayClose, LV_EVENT_CLICKED, nullptr);

    if (isLCARS) {
        // LCARS pill-shaped close button
        lv_obj_set_size(fanOverlay.closeBtn, 80, 30);
        lv_obj_align(fanOverlay.closeBtn, LV_ALIGN_BOTTOM_MID, 0, -20);
        lv_obj_set_style_bg_color(fanOverlay.closeBtn, lcarsTan, 0);
        lv_obj_set_style_bg_opa(fanOverlay.closeBtn, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(fanOverlay.closeBtn, 15, 0);

        lv_obj_t* closeLabel = lv_label_create(fanOverlay.closeBtn);
        lv_label_set_text(closeLabel, "CLOSE");
        lv_obj_set_style_text_color(closeLabel, lv_color_black(), 0);
        lv_obj_set_style_text_font(closeLabel, &lv_font_montserrat_14, 0);
        lv_obj_center(closeLabel);
    } else {
        // Standard circular X button
        lv_obj_set_size(fanOverlay.closeBtn, 40, 40);
        lv_obj_align(fanOverlay.closeBtn, LV_ALIGN_TOP_RIGHT, -10, 10);
        lv_obj_set_style_bg_color(fanOverlay.closeBtn, lv_color_hex(0x48484a), 0);
        lv_obj_set_style_bg_opa(fanOverlay.closeBtn, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(fanOverlay.closeBtn, LV_RADIUS_CIRCLE, 0);

        lv_obj_t* closeIcon = lv_label_create(fanOverlay.closeBtn);
        lv_label_set_text(closeIcon, LV_SYMBOL_CLOSE);
        lv_obj_set_style_text_color(closeIcon, lv_color_white(), 0);
        lv_obj_center(closeIcon);
    }

    // Initially hidden
    lv_obj_add_flag(fanOverlay.overlay, LV_OBJ_FLAG_HIDDEN);
}

void UIManager::showFanOverlay(int cardIndex) {
    if (cardIndex < 0 || cardIndex >= numButtons) return;

    UIButtonCard& card = buttonCards[cardIndex];
    const DeviceConfig& config = configManager.getConfig();

    // Create overlay if it doesn't exist
    if (fanOverlay.overlay == nullptr) {
        createFanOverlay();
    }

    fanOverlay.cardIndex = cardIndex;
    fanOverlay.visible = true;

    // Update title
    lv_label_set_text(fanOverlay.titleLabel, config.buttons[cardIndex].name.c_str());

    // Set slider range based on speed steps
    uint8_t steps = card.speedSteps > 0 ? card.speedSteps : 3;
    lv_slider_set_range(fanOverlay.slider, 0, steps);
    lv_slider_set_value(fanOverlay.slider, card.speedLevel, LV_ANIM_OFF);

    // Update visuals
    updateFanOverlayVisuals();

    // Show overlay
    lv_obj_clear_flag(fanOverlay.overlay, LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(fanOverlay.overlay);

    Serial.printf("UIManager: Showing fan overlay for card %d (steps=%d, level=%d)\n",
                  cardIndex, steps, card.speedLevel);
}

void UIManager::hideFanOverlay() {
    if (fanOverlay.overlay) {
        lv_obj_add_flag(fanOverlay.overlay, LV_OBJ_FLAG_HIDDEN);
    }
    fanOverlay.visible = false;
    fanOverlay.cardIndex = -1;
    Serial.println("UIManager: Fan overlay hidden");
}

void UIManager::updateFanOverlayVisuals() {
    if (!fanOverlay.visible || fanOverlay.cardIndex < 0) return;

    UIButtonCard& card = buttonCards[fanOverlay.cardIndex];
    int level = lv_slider_get_value(fanOverlay.slider);
    bool isLCARS = themeEngine.isLCARS();

    // Update status text
    const char* statusText;
    if (level == 0) {
        statusText = isLCARS ? "STANDBY" : "Off";
    } else {
        uint8_t steps = card.speedSteps > 0 ? card.speedSteps : 3;
        if (steps == 3) {
            if (isLCARS) {
                const char* speedNames[] = {"STANDBY", "LOW", "MEDIUM", "HIGH"};
                statusText = speedNames[level];
            } else {
                const char* speedNames[] = {"Off", "Low", "Medium", "High"};
                statusText = speedNames[level];
            }
        } else if (steps == 4) {
            if (isLCARS) {
                const char* speedNames[] = {"STANDBY", "LOW", "MEDIUM", "HIGH", "TURBO"};
                statusText = speedNames[level];
            } else {
                const char* speedNames[] = {"Off", "Low", "Medium", "High", "Turbo"};
                statusText = speedNames[level];
            }
        } else {
            static char buf[16];
            snprintf(buf, sizeof(buf), isLCARS ? "SPEED %d" : "Speed %d", level);
            statusText = buf;
        }
    }
    lv_label_set_text(fanOverlay.statusLabel, statusText);

    // LCARS colors
    lv_color_t lcarsPurple = lv_color_hex(0x9977aa);
    lv_color_t lcarsTan = lv_color_hex(0xffcc99);

    // Update icon color
    lv_color_t iconColor;
    if (isLCARS) {
        iconColor = level > 0 ? lcarsPurple : lv_color_hex(0x555555);
    } else {
        iconColor = level > 0 ? lv_color_hex(0x32d74b) : lv_color_hex(0x98989d);
    }
    lv_obj_set_style_img_recolor(fanOverlay.fanIcon, iconColor, 0);

    // Update slider indicator color
    lv_color_t sliderColor;
    if (isLCARS) {
        sliderColor = level > 0 ? lcarsPurple : lv_color_hex(0x1a1a1a);
    } else {
        sliderColor = level > 0 ? lv_color_hex(0x32d74b) : lv_color_hex(0x48484a);
    }
    lv_obj_set_style_bg_color(fanOverlay.slider, sliderColor, LV_PART_INDICATOR);
}

void UIManager::setFanSpeed(uint8_t buttonId, uint8_t speedLevel) {
    for (int i = 0; i < numButtons; i++) {
        if (buttonCards[i].buttonId == buttonId) {
            buttonCards[i].speedLevel = speedLevel;
            buttonCards[i].currentState = (speedLevel > 0);

            // Update card visual
            updateCardVisual(buttonCards[i]);

            // Update config
            configManager.setButtonState(buttonId, speedLevel > 0);
            // TODO: Save speed level to config

            Serial.printf("UIManager: Fan %d speed set to %d\n", buttonId, speedLevel);
            return;
        }
    }
}

uint8_t UIManager::getFanSpeed(uint8_t buttonId) const {
    for (int i = 0; i < numButtons; i++) {
        if (buttonCards[i].buttonId == buttonId) {
            return buttonCards[i].speedLevel;
        }
    }
    return 0;
}

// Static callbacks
void UIManager::onFanSliderChanged(lv_event_t* e) {
    lv_event_code_t code = lv_event_get_code(e);
    int level = lv_slider_get_value(uiManager.fanOverlay.slider);
    int cardIndex = uiManager.fanOverlay.cardIndex;

    if (cardIndex >= 0 && cardIndex < uiManager.numButtons) {
        UIButtonCard& card = uiManager.buttonCards[cardIndex];

        // Always update overlay visuals for smooth feedback
        uiManager.updateFanOverlayVisuals();

        // Only do heavy operations on release to avoid sluggishness
        if (code == LV_EVENT_VALUE_CHANGED) {
            // Light update - just store the value
            card.speedLevel = level;
            card.currentState = (level > 0);
        }

        if (code == LV_EVENT_RELEASED || lv_slider_is_dragged(uiManager.fanOverlay.slider) == false) {
            // Heavy operations only on release
            card.speedLevel = level;
            card.currentState = (level > 0);

            // Update the card in the main UI
            uiManager.updateCardVisual(card);

            // Update config state
            configManager.setButtonState(card.buttonId, level > 0);

            // Notify callback (async HTTP, won't block UI)
            if (uiManager.buttonCallback) {
                uiManager.buttonCallback(card.buttonId, level > 0);
            }

            Serial.printf("UIManager: Fan speed set to %d\n", level);
        }
    }
}

void UIManager::onFanOverlayClose(lv_event_t* e) {
    uiManager.hideFanOverlay();
}

void UIManager::createLCARSCard(int index, const ButtonConfig& btnConfig, int x, int y, int w, int h) {
    lv_color_t lcarsPurpleActive = lv_color_hex(0x664477);
    lv_color_t lcarsPurpleStandby = lv_color_hex(0x9977aa);
    lv_color_t lcarsYellow = lv_color_hex(0xffcc66);

    UIButtonCard& card = buttonCards[index];
    card.buttonId = btnConfig.id;
    card.currentState = btnConfig.state;
    card.speedSteps = btnConfig.speedSteps;
    card.speedLevel = btnConfig.speedLevel;

    // Create card
    card.card = lv_obj_create(screen);
    lv_obj_clear_flag(card.card, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(card.card, w, h);
    lv_obj_set_pos(card.card, x, y);
    lv_obj_set_style_bg_color(card.card, card.currentState ? lcarsPurpleActive : lcarsPurpleStandby, 0);
    lv_obj_set_style_bg_opa(card.card, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(card.card, 20, 0);
    lv_obj_set_style_border_width(card.card, 0, 0);

    // Make clickable
    lv_obj_add_flag(card.card, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(card.card, onCardClicked, LV_EVENT_CLICKED, (void*)(intptr_t)index);

    // LCARS layout: Icon on left, text stacked on right
    // Icon - vertically centered on left side, use image for fans
    // Smaller icon for shorter cards
    int iconOffset = (h >= 80) ? 15 : 10;
    const lv_font_t* iconFont = (h >= 80) ? &lv_font_montserrat_28 : &lv_font_montserrat_20;

    if (btnConfig.type == ButtonType::FAN) {
        card.icon = lv_img_create(card.card);
        lv_img_set_src(card.icon, &fan_icon);
        lv_obj_set_style_img_recolor(card.icon, card.currentState ? lv_color_white() : lcarsYellow, 0);
        lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
        lv_obj_align(card.icon, LV_ALIGN_LEFT_MID, iconOffset, 0);
        card.iconIsImage = true;
    } else if (isImageIcon(btnConfig.icon)) {
        // Use custom image icon
        card.icon = lv_img_create(card.card);
        lv_img_set_src(card.icon, getIconImage(btnConfig.icon));
        lv_obj_set_style_img_recolor(card.icon, card.currentState ? lv_color_white() : lcarsYellow, 0);
        lv_obj_set_style_img_recolor_opa(card.icon, LV_OPA_COVER, 0);
        lv_obj_align(card.icon, LV_ALIGN_LEFT_MID, iconOffset, 0);
        card.iconIsImage = true;
    } else {
        card.icon = lv_label_create(card.card);
        const char* iconSymbol = getIconSymbol(btnConfig.icon);
        lv_label_set_text(card.icon, iconSymbol);
        lv_obj_set_style_text_font(card.icon, iconFont, 0);
        lv_obj_set_style_text_color(card.icon, card.currentState ? lv_color_white() : lcarsYellow, 0);
        lv_obj_align(card.icon, LV_ALIGN_LEFT_MID, iconOffset, 0);
        card.iconIsImage = false;
    }

    // Room name - on right side
    card.nameLabel = lv_label_create(card.card);
    String upperName = btnConfig.name;
    upperName.toUpperCase();
    lv_label_set_text(card.nameLabel, upperName.c_str());
    lv_obj_set_style_text_color(card.nameLabel, card.currentState ? lv_color_white() : lcarsYellow, 0);
    lv_obj_set_width(card.nameLabel, w - 55);  // Width minus icon area
    lv_label_set_long_mode(card.nameLabel, LV_LABEL_LONG_DOT);  // Add ... if too long

    // Status text - below name on right side
    card.stateLabel = lv_label_create(card.card);
    // For fans with speed steps, show speed level
    if (card.speedSteps > 0) {
        const char* speedText = "STANDBY";
        if (card.speedLevel == 0) speedText = "STANDBY";
        else if (card.speedLevel == 1) speedText = "LOW";
        else if (card.speedLevel == 2) speedText = "MEDIUM";
        else speedText = "HIGH";
        lv_label_set_text(card.stateLabel, speedText);
    } else {
        lv_label_set_text(card.stateLabel, card.currentState ? "ACTIVE" : "STANDBY");
    }
    lv_obj_set_style_text_color(card.stateLabel, card.currentState ? lv_color_white() : lcarsYellow, 0);

    // Adjust layout based on card height
    if (h >= 80) {
        // Tall cards: larger fonts, stacked vertically
        lv_obj_set_style_text_font(card.nameLabel, &lv_font_montserrat_16, 0);
        lv_obj_set_style_text_font(card.stateLabel, &lv_font_montserrat_14, 0);
        lv_obj_align(card.nameLabel, LV_ALIGN_LEFT_MID, 50, -12);
        lv_obj_align(card.stateLabel, LV_ALIGN_LEFT_MID, 50, 12);
    } else {
        // Short cards: smaller fonts, tighter spacing
        lv_obj_set_style_text_font(card.nameLabel, &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_font(card.stateLabel, &lv_font_montserrat_14, 0);
        lv_obj_align(card.nameLabel, LV_ALIGN_LEFT_MID, 45, -8);
        lv_obj_align(card.stateLabel, LV_ALIGN_LEFT_MID, 45, 10);
    }

    // No toggle for LCARS
    card.toggle = nullptr;
}

void UIManager::updateButtonState(uint8_t buttonId, bool state) {
    for (int i = 0; i < numButtons; i++) {
        if (buttonCards[i].buttonId == buttonId) {
            buttonCards[i].currentState = state;
            updateCardVisual(buttonCards[i]);

            // Update config
            configManager.setButtonState(buttonId, state);
            return;
        }
    }
}

void UIManager::updateCardVisual(UIButtonCard& card) {
    int index = &card - buttonCards;  // Get index from pointer

    if (themeEngine.isLCARS()) {
        // LCARS-specific visual update
        lv_color_t lcarsPurpleActive = lv_color_hex(0x664477);
        lv_color_t lcarsPurpleStandby = lv_color_hex(0x9977aa);
        lv_color_t lcarsYellow = lv_color_hex(0xffcc66);

        lv_obj_set_style_bg_color(card.card, card.currentState ? lcarsPurpleActive : lcarsPurpleStandby, 0);
        // Update icon color - use img_recolor for images, text_color for labels
        if (card.iconIsImage) {
            lv_obj_set_style_img_recolor(card.icon, card.currentState ? lv_color_white() : lcarsYellow, 0);
        } else {
            lv_obj_set_style_text_color(card.icon, card.currentState ? lv_color_white() : lcarsYellow, 0);
        }
        lv_obj_set_style_text_color(card.nameLabel, card.currentState ? lv_color_white() : lcarsYellow, 0);

        if (card.stateLabel) {
            // For fans with speed steps, show speed level
            if (card.speedSteps > 0) {
                const char* speedText = "STANDBY";
                if (card.speedLevel == 0) speedText = "STANDBY";
                else if (card.speedLevel == 1) speedText = "LOW";
                else if (card.speedLevel == 2) speedText = "MEDIUM";
                else speedText = "HIGH";
                lv_label_set_text(card.stateLabel, speedText);
            } else {
                lv_label_set_text(card.stateLabel, card.currentState ? "ACTIVE" : "STANDBY");
            }
            lv_obj_set_style_text_color(card.stateLabel, card.currentState ? lv_color_white() : lcarsYellow, 0);
        }
    } else {
        // Standard theme update
        themeEngine.styleCard(card.card, card.currentState, index);
        // Update icon color - use img_recolor for images, text_color for labels
        if (card.iconIsImage) {
            lv_obj_set_style_img_recolor(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
        } else {
            lv_obj_set_style_text_color(card.icon, themeEngine.getIconColor(card.currentState, index), 0);
        }

        // Update toggle state (if toggle exists - not in cyberpunk mode)
        if (card.toggle) {
            if (card.currentState) {
                lv_obj_add_state(card.toggle, LV_STATE_CHECKED);
            } else {
                lv_obj_clear_state(card.toggle, LV_STATE_CHECKED);
            }
        }

        // Update status text if present
        if (card.stateLabel) {
            if (themeEngine.isCyberpunk()) {
                lv_label_set_text(card.stateLabel, card.currentState ? "[ONLINE]" : "[OFFLINE]");
            } else {
                lv_label_set_text(card.stateLabel, themeEngine.getStateText(card.currentState));
            }
            lv_obj_set_style_text_color(card.stateLabel, themeEngine.getIconColor(card.currentState, index), 0);
        }
    }
}

void UIManager::refreshAllButtons() {
    for (int i = 0; i < numButtons; i++) {
        updateCardVisual(buttonCards[i]);
    }
}

void UIManager::setButtonCallback(UIButtonCallback callback) {
    buttonCallback = callback;
}

void UIManager::setSceneCallback(UISceneCallback callback) {
    sceneCallback = callback;
}

// Static event handlers
void UIManager::onToggleChanged(lv_event_t* e) {
    int index = (int)(intptr_t)lv_event_get_user_data(e);
    lv_obj_t* toggle = lv_event_get_target(e);
    bool newState = lv_obj_has_state(toggle, LV_STATE_CHECKED);

    if (index >= 0 && index < uiManager.numButtons) {
        UIButtonCard& card = uiManager.buttonCards[index];
        card.currentState = newState;
        uiManager.updateCardVisual(card);

        // Update config
        configManager.setButtonState(card.buttonId, newState);

        // Notify callback (async HTTP, won't block UI)
        if (uiManager.buttonCallback) {
            uiManager.buttonCallback(card.buttonId, newState);
        }

        Serial.printf("UIManager: Button %d toggled to %s\n", card.buttonId, newState ? "ON" : "OFF");
    }
}

void UIManager::onCardClicked(lv_event_t* e) {
    int index = (int)(intptr_t)lv_event_get_user_data(e);

    if (index >= 0 && index < uiManager.numButtons) {
        UIButtonCard& card = uiManager.buttonCards[index];

        // For scene buttons, call the scene callback with visual feedback
        if (card.isSceneButton) {
            Serial.printf("UIManager: Scene button %d clicked, scene: %s\n", card.buttonId, card.sceneId.c_str());

            // Visual feedback: flash the card with a brief highlight animation
            lv_obj_t* cardObj = card.card;

            // Store original background color and create flash effect
            lv_color_t originalBg = lv_obj_get_style_bg_color(cardObj, 0);
            lv_opa_t originalOpa = lv_obj_get_style_bg_opa(cardObj, 0);

            // Flash with bright accent color (purple for scenes)
            lv_color_t flashColor = lv_color_hex(0xa855f7);  // Purple
            if (themeEngine.isCyberpunk()) {
                flashColor = lv_color_hex(0xff0080);  // Neon pink for cyberpunk
            } else if (themeEngine.isLCARS()) {
                flashColor = lv_color_hex(0xCC7832);  // LCARS orange
            }

            // Apply flash effect
            lv_obj_set_style_bg_color(cardObj, flashColor, 0);
            lv_obj_set_style_bg_opa(cardObj, LV_OPA_80, 0);

            // Create animation to restore original color
            lv_anim_t anim;
            lv_anim_init(&anim);
            lv_anim_set_var(&anim, cardObj);
            lv_anim_set_time(&anim, 200);  // 200ms flash duration
            lv_anim_set_delay(&anim, 100); // Small delay to show flash
            lv_anim_set_exec_cb(&anim, [](void* obj, int32_t val) {
                lv_obj_set_style_bg_opa((lv_obj_t*)obj, val, 0);
            });
            lv_anim_set_values(&anim, LV_OPA_80, originalOpa);
            lv_anim_set_path_cb(&anim, lv_anim_path_ease_out);
            lv_anim_set_ready_cb(&anim, [](lv_anim_t* a) {
                // Restore original background (in case theme changed)
                lv_obj_t* obj = (lv_obj_t*)a->var;
                themeEngine.styleCard(obj, false);  // Re-apply theme styling
            });
            lv_anim_start(&anim);

            // Use the button callback to trigger the scene
            if (uiManager.buttonCallback) {
                uiManager.buttonCallback(card.buttonId, true);  // Always send "true" for scene activation
            }
            return;
        }

        // For fans with speed control, show the overlay instead of toggling
        if (card.speedSteps > 0) {
            uiManager.showFanOverlay(index);
            return;
        }

        // Toggle state for non-fan devices
        card.currentState = !card.currentState;
        uiManager.updateCardVisual(card);

        // Update config
        configManager.setButtonState(card.buttonId, card.currentState);

        // Notify callback (async HTTP, won't block UI)
        if (uiManager.buttonCallback) {
            uiManager.buttonCallback(card.buttonId, card.currentState);
        }

        Serial.printf("UIManager: Card %d clicked, now %s\n", card.buttonId, card.currentState ? "ON" : "OFF");
    }
}

void UIManager::onSceneClicked(lv_event_t* e) {
    int index = (int)(intptr_t)lv_event_get_user_data(e);

    if (index >= 0 && index < uiManager.numScenes) {
        UISceneButton& scene = uiManager.sceneButtons[index];

        // Notify callback
        if (uiManager.sceneCallback) {
            uiManager.sceneCallback(scene.sceneId);
        }

        Serial.printf("UIManager: Scene %d activated\n", scene.sceneId);
    }
}

const char* UIManager::getIconSymbol(const String& iconName) {
    // Map icon names to LVGL symbols
    if (iconName == "bolt" || iconName == "charge") {
        return LV_SYMBOL_CHARGE;  // Lightning bolt
    } else if (iconName == "light" || iconName == "bulb") {
        return "\xEF\x83\xAB";  // Font Awesome lightbulb (U+F0EB) - falls back to charge if not in font
    } else if (iconName == "moon") {
        return LV_SYMBOL_EYE_CLOSE;  // Use eye-close as moon substitute
    } else if (iconName == "sun") {
        return LV_SYMBOL_IMAGE;  // Use image symbol as sun substitute (bright/display)
    } else if (iconName == "fan" || iconName == "ventilation") {
        return LV_SYMBOL_REFRESH;  // Use refresh as fan symbol (circular motion)
    } else if (iconName == "power" || iconName == "off") {
        return LV_SYMBOL_POWER;
    } else if (iconName == "ok" || iconName == "check" || iconName == "on") {
        return LV_SYMBOL_OK;
    } else if (iconName == "home") {
        return LV_SYMBOL_HOME;
    } else if (iconName == "settings" || iconName == "gear") {
        return LV_SYMBOL_SETTINGS;
    } else if (iconName == "wifi") {
        return LV_SYMBOL_WIFI;
    } else if (iconName == "bell" || iconName == "notification") {
        return LV_SYMBOL_BELL;
    } else if (iconName == "eye") {
        return LV_SYMBOL_EYE_OPEN;
    } else if (iconName == "eye_close" || iconName == "sleep") {
        return LV_SYMBOL_EYE_CLOSE;
    } else if (iconName == "play") {
        return LV_SYMBOL_PLAY;
    } else if (iconName == "pause") {
        return LV_SYMBOL_PAUSE;
    } else if (iconName == "stop") {
        return LV_SYMBOL_STOP;
    } else if (iconName == "volume" || iconName == "audio") {
        return LV_SYMBOL_VOLUME_MAX;
    } else if (iconName == "mute") {
        return LV_SYMBOL_MUTE;
    } else if (iconName == "minus") {
        return LV_SYMBOL_MINUS;
    } else if (iconName == "plus") {
        return LV_SYMBOL_PLUS;
    } else if (iconName == "close" || iconName == "x") {
        return LV_SYMBOL_CLOSE;
    } else if (iconName == "refresh" || iconName == "sync") {
        return LV_SYMBOL_REFRESH;
    } else if (iconName == "edit" || iconName == "pen") {
        return LV_SYMBOL_EDIT;
    } else if (iconName == "trash" || iconName == "delete") {
        return LV_SYMBOL_TRASH;
    } else if (iconName == "tint" || iconName == "water" || iconName == "drop") {
        return LV_SYMBOL_TINT;
    }

    // Default
    return LV_SYMBOL_CHARGE;
}

// Check if an icon name requires an image (custom icon) instead of a text symbol
bool UIManager::isImageIcon(const String& iconName) {
    return (iconName == "garage" ||
            iconName == "sleep" ||
            iconName == "ceiling_light" || iconName == "ceiling-light" ||
            iconName == "bulb" ||
            iconName == "door" ||
            iconName == "moon" ||
            iconName == "sun");
}

// Get the image descriptor for an image-based icon
const lv_img_dsc_t* UIManager::getIconImage(const String& iconName) {
    if (iconName == "garage") {
        return &garage_icon;
    } else if (iconName == "sleep") {
        return &sleep_icon;
    } else if (iconName == "ceiling_light" || iconName == "ceiling-light") {
        return &ceiling_light_icon;
    } else if (iconName == "bulb") {
        return &bulb_icon;
    } else if (iconName == "door") {
        return &door_icon;
    } else if (iconName == "moon") {
        return &moon_icon;
    } else if (iconName == "sun") {
        return &sun_icon;
    }
    return nullptr;
}

// ============================================================================
// SERVER CHANGE CONFIRMATION DIALOG
// ============================================================================

void UIManager::createServerChangeDialog() {
    // Create semi-transparent background overlay
    serverChangeState.overlay = lv_obj_create(lv_scr_act());
    lv_obj_set_size(serverChangeState.overlay, SCREEN_WIDTH, SCREEN_HEIGHT);
    lv_obj_set_pos(serverChangeState.overlay, 0, 0);
    lv_obj_set_style_bg_color(serverChangeState.overlay, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(serverChangeState.overlay, LV_OPA_80, 0);
    lv_obj_set_style_border_width(serverChangeState.overlay, 0, 0);
    lv_obj_clear_flag(serverChangeState.overlay, LV_OBJ_FLAG_SCROLLABLE);

    // Create the main panel
    serverChangeState.panel = lv_obj_create(serverChangeState.overlay);
    lv_obj_set_size(serverChangeState.panel, 380, 280);
    lv_obj_center(serverChangeState.panel);
    lv_obj_clear_flag(serverChangeState.panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(serverChangeState.panel, lv_color_hex(0x2c2c2e), 0);
    lv_obj_set_style_bg_opa(serverChangeState.panel, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(serverChangeState.panel, 20, 0);
    lv_obj_set_style_border_width(serverChangeState.panel, 2, 0);
    lv_obj_set_style_border_color(serverChangeState.panel, lv_color_hex(0xff9500), 0);

    // Warning icon
    lv_obj_t* warningIcon = lv_label_create(serverChangeState.panel);
    lv_label_set_text(warningIcon, LV_SYMBOL_WARNING);
    lv_obj_set_style_text_font(warningIcon, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(warningIcon, lv_color_hex(0xff9500), 0);
    lv_obj_align(warningIcon, LV_ALIGN_TOP_MID, 0, 15);

    // Title
    serverChangeState.titleLabel = lv_label_create(serverChangeState.panel);
    lv_label_set_text(serverChangeState.titleLabel, "Server Change Request");
    lv_obj_set_style_text_font(serverChangeState.titleLabel, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(serverChangeState.titleLabel, lv_color_white(), 0);
    lv_obj_align(serverChangeState.titleLabel, LV_ALIGN_TOP_MID, 0, 55);

    // Message
    serverChangeState.messageLabel = lv_label_create(serverChangeState.panel);
    lv_label_set_text(serverChangeState.messageLabel, "A server is requesting to\nchange your connection to:");
    lv_obj_set_style_text_font(serverChangeState.messageLabel, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(serverChangeState.messageLabel, lv_color_hex(0x8e8e93), 0);
    lv_obj_set_style_text_align(serverChangeState.messageLabel, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(serverChangeState.messageLabel, LV_ALIGN_TOP_MID, 0, 90);

    // Server address display
    serverChangeState.serverLabel = lv_label_create(serverChangeState.panel);
    lv_label_set_text(serverChangeState.serverLabel, serverChangeState.newReportingUrl.c_str());
    lv_obj_set_style_text_font(serverChangeState.serverLabel, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(serverChangeState.serverLabel, lv_color_hex(0x32d74b), 0);
    lv_obj_set_width(serverChangeState.serverLabel, 340);
    lv_label_set_long_mode(serverChangeState.serverLabel, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_align(serverChangeState.serverLabel, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(serverChangeState.serverLabel, LV_ALIGN_TOP_MID, 0, 140);

    // Accept button
    serverChangeState.acceptBtn = lv_btn_create(serverChangeState.panel);
    lv_obj_set_size(serverChangeState.acceptBtn, 140, 45);
    lv_obj_align(serverChangeState.acceptBtn, LV_ALIGN_BOTTOM_LEFT, 25, -20);
    lv_obj_set_style_bg_color(serverChangeState.acceptBtn, lv_color_hex(0x32d74b), 0);
    lv_obj_set_style_radius(serverChangeState.acceptBtn, 10, 0);
    lv_obj_set_style_shadow_width(serverChangeState.acceptBtn, 0, 0);
    lv_obj_add_event_cb(serverChangeState.acceptBtn, onServerChangeAccept, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* acceptLabel = lv_label_create(serverChangeState.acceptBtn);
    lv_label_set_text(acceptLabel, "Accept");
    lv_obj_set_style_text_font(acceptLabel, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(acceptLabel, lv_color_white(), 0);
    lv_obj_center(acceptLabel);

    // Reject button
    serverChangeState.rejectBtn = lv_btn_create(serverChangeState.panel);
    lv_obj_set_size(serverChangeState.rejectBtn, 140, 45);
    lv_obj_align(serverChangeState.rejectBtn, LV_ALIGN_BOTTOM_RIGHT, -25, -20);
    lv_obj_set_style_bg_color(serverChangeState.rejectBtn, lv_color_hex(0xff3b30), 0);
    lv_obj_set_style_radius(serverChangeState.rejectBtn, 10, 0);
    lv_obj_set_style_shadow_width(serverChangeState.rejectBtn, 0, 0);
    lv_obj_add_event_cb(serverChangeState.rejectBtn, onServerChangeReject, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* rejectLabel = lv_label_create(serverChangeState.rejectBtn);
    lv_label_set_text(rejectLabel, "Reject");
    lv_obj_set_style_text_font(rejectLabel, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(rejectLabel, lv_color_white(), 0);
    lv_obj_center(rejectLabel);
}

void UIManager::showServerChangeConfirmation(const String& newReportingUrl) {
    // Store the pending change
    serverChangeState.pending = true;
    serverChangeState.newReportingUrl = newReportingUrl;

    // Create and show the dialog
    createServerChangeDialog();

    Serial.printf("UIManager: Showing server change confirmation for %s\n",
                  newReportingUrl.c_str());
}

void UIManager::hideServerChangeConfirmation() {
    if (serverChangeState.overlay) {
        lv_obj_del(serverChangeState.overlay);
        serverChangeState.overlay = nullptr;
        serverChangeState.panel = nullptr;
        serverChangeState.titleLabel = nullptr;
        serverChangeState.messageLabel = nullptr;
        serverChangeState.serverLabel = nullptr;
        serverChangeState.acceptBtn = nullptr;
        serverChangeState.rejectBtn = nullptr;
    }
    serverChangeState.pending = false;
    serverChangeState.newReportingUrl = "";
}

bool UIManager::isServerChangePending() const {
    return serverChangeState.pending;
}

String UIManager::getPendingReportingUrl() const {
    return serverChangeState.newReportingUrl;
}

void UIManager::onServerChangeAccept(lv_event_t* e) {
    Serial.println("UIManager: Server change accepted by user");

    // Get the pending server info
    String newUrl = uiManager.serverChangeState.newReportingUrl;

    // Update the config
    configManager.setReportingUrl(newUrl);
    configManager.saveConfig();

    // Hide the dialog
    uiManager.hideServerChangeConfirmation();

    Serial.printf("UIManager: Server reporting URL changed to %s and saved to NVS\n",
                  newUrl.c_str());
}

void UIManager::onServerChangeReject(lv_event_t* e) {
    Serial.println("UIManager: Server change rejected by user");

    // Just hide the dialog, don't change anything
    uiManager.hideServerChangeConfirmation();
}
