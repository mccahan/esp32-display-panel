#include <Arduino.h>
#include <lvgl.h>
#include <WiFi.h>
#include <Wire.h>
#include <Preferences.h>
#include <Arduino_GFX_Library.h>
#include <TAMC_GT911.h>

// New modular includes
#include "config_manager.h"
#include "theme_engine.h"
#include "ui_manager.h"
#include "device_controller.h"
#include "mdns_service.h"
#include "web_server.h"
#include "screenshot.h"
#include "time_manager.h"
#include "brightness_scheduler.h"

// Optional: include secrets.h for default WiFi credentials
#if __has_include("secrets.h")
#include "secrets.h"
#define HAS_DEFAULT_WIFI 1
#else
#define HAS_DEFAULT_WIFI 0
#endif

// ============================================================================
// PIN DEFINITIONS for Guition ESP32-S3-4848S040
// ============================================================================

// Touch controller pins
#define TOUCH_SDA 19
#define TOUCH_SCL 45
#define TOUCH_INT -1  // Not connected
#define TOUCH_RST -1  // Not connected

// Backlight pin (PWM controlled via ui_manager)
#define GFX_BL 38

// Display dimensions
#define TFT_WIDTH 480
#define TFT_HEIGHT 480

// ============================================================================
// DISPLAY HARDWARE CONFIGURATION
// ============================================================================

// Touch controller instance
TAMC_GT911 touchController(TOUCH_SDA, TOUCH_SCL, TOUCH_INT, TOUCH_RST, TFT_WIDTH, TFT_HEIGHT);

// Display bus configuration for ESP32-S3-4848S040
Arduino_ESP32RGBPanel *bus = new Arduino_ESP32RGBPanel(
    39 /* CS */, 48 /* SCK */, 47 /* SDA */,
    18 /* DE */, 17 /* VSYNC */, 16 /* HSYNC */, 21 /* PCLK */,
    11 /* R0 */, 12 /* R1 */, 13 /* R2 */, 14 /* R3 */, 0 /* R4 */,
    8 /* G0 */, 20 /* G1 */, 3 /* G2 */, 46 /* G3 */, 9 /* G4 */, 10 /* G5 */,
    4 /* B0 */, 5 /* B1 */, 6 /* B2 */, 7 /* B3 */, 15 /* B4 */
);

// ST7701 display panel
Arduino_ST7701_RGBPanel *gfx = new Arduino_ST7701_RGBPanel(
    bus, GFX_NOT_DEFINED /* RST */, 0 /* rotation */,
    true /* IPS */, TFT_WIDTH /* width */, TFT_HEIGHT /* height */,
    st7701_type1_init_operations, sizeof(st7701_type1_init_operations),
    true /* BGR */,
    10 /* hsync_front_porch */, 8 /* hsync_pulse_width */, 50 /* hsync_back_porch */,
    10 /* vsync_front_porch */, 8 /* vsync_pulse_width */, 20 /* vsync_back_porch */
);

// ============================================================================
// LVGL CONFIGURATION
// ============================================================================

// LVGL display buffers (double buffered in PSRAM)
static lv_disp_draw_buf_t draw_buf;
static lv_color_t *disp_draw_buf1;
static lv_color_t *disp_draw_buf2;
static lv_disp_drv_t disp_drv;

// LVGL tick tracking
static unsigned long last_tick = 0;

// LVGL touch input device
static lv_indev_drv_t indev_drv;
static lv_indev_t *touch_indev = nullptr;

// WiFi preferences storage
Preferences wifi_prefs;

// ============================================================================
// LVGL CALLBACKS
// ============================================================================

// Display flush callback - sends pixels to the display
void my_disp_flush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p) {
    uint32_t w = (area->x2 - area->x1 + 1);
    uint32_t h = (area->y2 - area->y1 + 1);

#if (LV_COLOR_16_SWAP != 0)
    gfx->draw16bitBeRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
#else
    gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
#endif

    lv_disp_flush_ready(disp);
}

// Touch read callback for LVGL
void my_touchpad_read(lv_indev_drv_t *drv, lv_indev_data_t *data) {
    touchController.read();

    if (touchController.isTouched) {
        // Notify brightness scheduler of touch event
        // If it returns true, the touch should be consumed (display was at 0%)
        if (brightnessScheduler.onTouchDetected()) {
            // Block button events - just wake the display
            data->state = LV_INDEV_STATE_RELEASED;
            return;
        }

        // Also block during wake grace period (500ms after display wakes)
        if (brightnessScheduler.shouldBlockButtons()) {
            data->state = LV_INDEV_STATE_RELEASED;
            return;
        }

        data->state = LV_INDEV_STATE_PRESSED;

        // Raw touch coordinates from GT911
        int16_t raw_x = touchController.points[0].x;
        int16_t raw_y = touchController.points[0].y;

        // Transform coordinates - GT911 has origin at bottom-right by default
        // Invert both axes for 0 degree rotation
        data->point.x = TFT_WIDTH - 1 - raw_x;
        data->point.y = TFT_HEIGHT - 1 - raw_y;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

void setupDisplay() {
    Serial.println("Initializing display...");

    // Lower pixel clock (8MHz) reduces tearing
    gfx->begin(8000000);
    gfx->fillScreen(BLACK);

    // Backlight will be controlled via PWM by ui_manager
    pinMode(GFX_BL, OUTPUT);
    digitalWrite(GFX_BL, HIGH);

    Serial.println("Display initialized");
}

void setupLVGL() {
    Serial.println("Initializing LVGL...");

    lv_init();

    // Full frame double buffers in PSRAM for smooth updates
    size_t buf_size = TFT_WIDTH * TFT_HEIGHT;

    disp_draw_buf1 = (lv_color_t *)heap_caps_malloc(sizeof(lv_color_t) * buf_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    disp_draw_buf2 = (lv_color_t *)heap_caps_malloc(sizeof(lv_color_t) * buf_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);

    if (!disp_draw_buf1 || !disp_draw_buf2) {
        Serial.println("Failed to allocate display buffers in PSRAM!");
        while (1) { delay(1000); }
    }

    Serial.printf("Display buffers allocated: 2 x %u bytes in PSRAM\n", sizeof(lv_color_t) * buf_size);

    // Initialize double buffering
    lv_disp_draw_buf_init(&draw_buf, disp_draw_buf1, disp_draw_buf2, buf_size);

    // Setup display driver
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = TFT_WIDTH;
    disp_drv.ver_res = TFT_HEIGHT;
    disp_drv.flush_cb = my_disp_flush;
    disp_drv.draw_buf = &draw_buf;
    disp_drv.full_refresh = 1;  // Always send full frame to reduce tearing
    lv_disp_drv_register(&disp_drv);

    Serial.println("LVGL initialized");
}

void setupTouch() {
    Serial.println("Initializing touch controller...");

    // Initialize I2C for touch controller
    Wire.begin(TOUCH_SDA, TOUCH_SCL);

    // Initialize GT911 touch controller
    touchController.begin();
    touchController.setRotation(ROTATION_NORMAL);

    // Register touch input device with LVGL
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = my_touchpad_read;
    touch_indev = lv_indev_drv_register(&indev_drv);

    Serial.println("Touch controller initialized");
}

void setupWiFi() {
    Serial.println("Setting up WiFi...");

    // Try to load saved credentials
    wifi_prefs.begin("wifi", false);
    String ssid = wifi_prefs.getString("ssid", "");
    String password = wifi_prefs.getString("password", "");
    wifi_prefs.end();

    // If no saved credentials, try default from secrets.h
#if HAS_DEFAULT_WIFI
    if (ssid.length() == 0) {
        Serial.println("No saved credentials, using defaults from secrets.h");
        ssid = WIFI_SSID;
        password = WIFI_PASSWORD;
    }
#endif

    if (ssid.length() > 0) {
        Serial.printf("Connecting to network: %s\n", ssid.c_str());
        WiFi.begin(ssid.c_str(), password.c_str());

        // Wait for connection with timeout
        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED && attempts < 20) {
            delay(500);
            Serial.print(".");
            attempts++;
        }
        Serial.println();

        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("Connected! IP: %s\n", WiFi.localIP().toString().c_str());
            return;
        }
    }

    // No saved credentials or connection failed - start AP mode for configuration
    Serial.println("Starting AP mode for WiFi configuration...");
    WiFi.mode(WIFI_AP);
    WiFi.softAP("ESP32-Display", "configure");
    Serial.printf("AP started. Connect to 'ESP32-Display' and visit http://%s\n",
                  WiFi.softAPIP().toString().c_str());
}

// Try to fetch config from server on boot
void tryFetchServerConfig() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi not connected, skipping server config fetch");
        return;
    }

    Serial.println("Attempting to fetch config from server...");
    if (configManager.fetchConfigFromServer()) {
        Serial.println("Config fetched from server successfully");
    } else {
        Serial.println("Using local config (server not available or device not registered)");
    }
}

// ============================================================================
// ARDUINO SETUP & LOOP
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("\n\n========================================");
    Serial.println("ESP32 Display Controller Starting...");
    Serial.println("========================================\n");

    // Check PSRAM
    if (psramFound()) {
        Serial.printf("PSRAM found: %d bytes (%d MB)\n",
                      ESP.getPsramSize(), ESP.getPsramSize() / 1024 / 1024);
    } else {
        Serial.println("WARNING: PSRAM not found!");
    }

    // Initialize screenshot storage
    initScreenshot();

    // Setup display hardware
    setupDisplay();

    // Initialize LVGL
    setupLVGL();

    // Initialize touch
    setupTouch();

    // Setup WiFi
    setupWiFi();

    // Initialize configuration manager (loads from NVS)
    configManager.begin();

    // Initialize theme engine
    themeEngine.begin();

    // Initialize UI manager (sets up PWM backlight)
    uiManager.begin();

    // Try to fetch config from server (may update config)
    tryFetchServerConfig();

    // Create the UI based on config
    uiManager.createUI();

    // Force initial render
    lv_timer_handler();

    // Initialize device controller (registers UI callbacks)
    deviceController.begin();

    // Start mDNS for device discovery
    if (WiFi.status() == WL_CONNECTED) {
        if (mdnsService.begin(configManager.getDeviceId())) {
            mdnsService.advertiseService();
        }
    }

    // Initialize time manager for NTP sync
    timeManager.begin();

    // Initialize brightness scheduler
    brightnessScheduler.begin();

    // Start web server
    webServer.begin();

    Serial.println("\n========================================");
    Serial.println("System Ready!");
    Serial.printf("Device ID:     %s\n", configManager.getDeviceId().c_str());
    Serial.printf("Theme:         %s\n", configManager.getConfig().display.theme.c_str());
    Serial.printf("Web interface: http://%s\n",
                  WiFi.status() == WL_CONNECTED ?
                  WiFi.localIP().toString().c_str() :
                  WiFi.softAPIP().toString().c_str());
    Serial.println("OTA updates:   http://<ip>/update");
    Serial.println("Screenshot:    POST /api/screenshot/capture");
    Serial.println("Config API:    GET/POST /api/config");
    Serial.println("========================================\n");
}

void loop() {
    // Update LVGL tick
    unsigned long now = millis();
    lv_tick_inc(now - last_tick);
    last_tick = now;

    // Handle LVGL tasks
    lv_timer_handler();

    // Check for pending UI rebuild (from web server callbacks)
    uiManager.update();

    // Device controller periodic tasks (server connectivity check)
    deviceController.update();

    // Update time manager (NTP sync)
    timeManager.update();

    // Update brightness scheduler
    brightnessScheduler.update();

    // Small delay to prevent watchdog issues
    delay(5);
}
