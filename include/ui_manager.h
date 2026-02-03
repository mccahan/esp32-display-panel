#ifndef UI_MANAGER_H
#define UI_MANAGER_H

#include <Arduino.h>
#include <lvgl.h>
#include "config_manager.h"
#include "theme_engine.h"

// Callback function type for button/scene press events
typedef void (*UIButtonCallback)(uint8_t buttonId, bool newState);
typedef void (*UISceneCallback)(uint8_t sceneId);

// UI element tracking for a button card
struct UIButtonCard {
    uint8_t buttonId;
    lv_obj_t* card;
    lv_obj_t* icon;
    lv_obj_t* nameLabel;
    lv_obj_t* stateLabel;  // For neon theme status text
    lv_obj_t* toggle;
    bool currentState;
    uint8_t speedSteps;    // For fans: number of speed steps
    uint8_t speedLevel;    // Current speed level
};

// Fan speed overlay state
struct FanOverlayState {
    bool visible;
    int cardIndex;
    lv_obj_t* overlay;
    lv_obj_t* panel;
    lv_obj_t* titleLabel;
    lv_obj_t* statusLabel;
    lv_obj_t* slider;
    lv_obj_t* sliderTrack;
    lv_obj_t* fanIcon;
    lv_obj_t* closeBtn;
};

// UI element tracking for a scene button
struct UISceneButton {
    uint8_t sceneId;
    lv_obj_t* button;
    lv_obj_t* label;
};

class UIManager {
public:
    UIManager();

    // Initialize UI manager
    void begin();

    // Create the complete UI based on current config
    void createUI();

    // Rebuild UI (e.g., after config change or theme change)
    void rebuildUI();

    // Request a deferred UI rebuild (thread-safe, for use from web server callbacks)
    void requestRebuild();

    // Check if rebuild is needed and perform it (call from main loop)
    void update();

    // Update a single button's visual state
    void updateButtonState(uint8_t buttonId, bool state);

    // Update all button visuals (e.g., after theme change)
    void refreshAllButtons();

    // Set the callback for button press events
    void setButtonCallback(UIButtonCallback callback);

    // Set the callback for scene activation events
    void setSceneCallback(UISceneCallback callback);

    // Set brightness (0-100)
    void setBrightness(uint8_t brightness);

    // Get current brightness
    uint8_t getBrightness() const;

    // Get LVGL symbol for icon name
    static const char* getIconSymbol(const String& iconName);

    // Fan speed control
    void showFanOverlay(int cardIndex);
    void hideFanOverlay();
    void setFanSpeed(uint8_t buttonId, uint8_t speedLevel);
    uint8_t getFanSpeed(uint8_t buttonId) const;

private:
    // UI elements
    lv_obj_t* screen;
    lv_obj_t* header;
    lv_obj_t* contentArea;
    lv_obj_t* actionBar;

    // Button and scene tracking
    UIButtonCard buttonCards[MAX_BUTTONS];
    UISceneButton sceneButtons[MAX_SCENES];
    uint8_t numButtons;
    uint8_t numScenes;

    // Callbacks
    UIButtonCallback buttonCallback;
    UISceneCallback sceneCallback;

    // Current brightness
    uint8_t currentBrightness;

    // Flag for deferred UI rebuild (set from web server, processed in main loop)
    volatile bool needsRebuild;

    // PWM channel for backlight
    static const uint8_t BACKLIGHT_PWM_CHANNEL = 0;
    static const uint8_t BACKLIGHT_PIN = 38;

    // Create individual UI components
    void createHeader();
    void createButtonGrid();
    void createActionBar();

    // Create LCARS-specific layout
    void createLCARSLayout();
    void createLCARSCard(int index, const ButtonConfig& config, int x, int y, int w, int h);

    // Cyberpunk decorations (grid lines, data bar, accent elements)
    void createCyberpunkDecorations();


    // Fan overlay functions
    void createFanOverlay();
    void updateFanOverlayVisuals();
    static void onFanSliderChanged(lv_event_t* e);
    static void onFanOverlayClose(lv_event_t* e);

    // Fan overlay state
    FanOverlayState fanOverlay;

    // Create a single button card
    void createButtonCard(int index, const ButtonConfig& config, int gridX, int gridY);

    // Create a scene button in the action bar
    void createSceneButton(int index, const SceneConfig& config, bool isLeft);

    // Update visual state of a card
    void updateCardVisual(UIButtonCard& card);

    // Calculate grid layout based on button count
    void calculateGridLayout(int numButtons, int& cols, int& rows,
                            int& cardWidth, int& cardHeight, int& gap);

    // Event handlers (static for LVGL callbacks)
    static void onToggleChanged(lv_event_t* e);
    static void onCardClicked(lv_event_t* e);
    static void onSceneClicked(lv_event_t* e);

    // Setup PWM for backlight
    void setupBacklightPWM();
};

// Global instance
extern UIManager uiManager;

#endif // UI_MANAGER_H
