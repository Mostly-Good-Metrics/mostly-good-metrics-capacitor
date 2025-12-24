"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@capacitor/core");
const javascript_1 = require("@mostly-good-metrics/javascript");
const storage_1 = require("./storage");
/** SDK version for metrics headers */
const SDK_VERSION = '0.1.0';
// Try to import Capacitor plugins, fall back to null if not available
let App = null;
let Device = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    App = require('@capacitor/app').App;
}
catch {
    // App plugin not installed
}
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Device = require('@capacitor/device').Device;
}
catch {
    // Device plugin not installed
}
// Use global to persist state across hot reloads
const g = globalThis;
// Initialize or restore state
if (!g.__MGM_CAPACITOR_STATE__) {
    g.__MGM_CAPACITOR_STATE__ = {
        appStateListener: null,
        isConfigured: false,
        isActive: true,
        debugLogging: false,
        lastLifecycleEvent: null,
        deviceInfo: null,
    };
}
const state = g.__MGM_CAPACITOR_STATE__;
const DEDUPE_INTERVAL_MS = 1000; // Ignore duplicate events within 1 second
function log(...args) {
    if (state.debugLogging) {
        console.log('[MostlyGoodMetrics]', ...args);
    }
}
/**
 * Track a lifecycle event with deduplication.
 */
function trackLifecycleEvent(eventName, properties) {
    const now = Date.now();
    // Deduplicate events that fire multiple times in quick succession
    if (state.lastLifecycleEvent &&
        state.lastLifecycleEvent.name === eventName &&
        now - state.lastLifecycleEvent.time < DEDUPE_INTERVAL_MS) {
        log(`Skipping duplicate ${eventName} (${now - state.lastLifecycleEvent.time}ms ago)`);
        return;
    }
    state.lastLifecycleEvent = { name: eventName, time: now };
    log(`Tracking lifecycle event: ${eventName}`);
    javascript_1.MostlyGoodMetrics.track(eventName, properties);
}
/**
 * Handle app state changes for lifecycle tracking.
 */
function handleAppStateChange(isActive) {
    if (!javascript_1.MostlyGoodMetrics.shared)
        return;
    log(`AppState change: ${state.isActive ? 'active' : 'background'} -> ${isActive ? 'active' : 'background'}`);
    // App came to foreground
    if (!state.isActive && isActive) {
        trackLifecycleEvent(javascript_1.SystemEvents.APP_OPENED);
    }
    // App went to background
    if (state.isActive && !isActive) {
        trackLifecycleEvent(javascript_1.SystemEvents.APP_BACKGROUNDED);
        // Flush events when going to background
        javascript_1.MostlyGoodMetrics.flush().catch((e) => log('Flush error:', e));
    }
    state.isActive = isActive;
}
/**
 * Track app install or update events.
 */
async function trackInstallOrUpdate(appVersion) {
    if (!appVersion)
        return;
    const previousVersion = await storage_1.persistence.getAppVersion();
    const isFirst = await storage_1.persistence.isFirstLaunch();
    if (isFirst) {
        trackLifecycleEvent(javascript_1.SystemEvents.APP_INSTALLED, {
            [javascript_1.SystemProperties.VERSION]: appVersion,
        });
        await storage_1.persistence.setAppVersion(appVersion);
    }
    else if (previousVersion && previousVersion !== appVersion) {
        trackLifecycleEvent(javascript_1.SystemEvents.APP_UPDATED, {
            [javascript_1.SystemProperties.VERSION]: appVersion,
            [javascript_1.SystemProperties.PREVIOUS_VERSION]: previousVersion,
        });
        await storage_1.persistence.setAppVersion(appVersion);
    }
    else if (!previousVersion) {
        await storage_1.persistence.setAppVersion(appVersion);
    }
}
/**
 * Load device info using Capacitor Device plugin.
 */
async function loadDeviceInfo() {
    if (!Device) {
        state.deviceInfo = {};
        return;
    }
    try {
        const info = await Device.getInfo();
        state.deviceInfo = {
            model: info.model,
            osVersion: info.osVersion,
            manufacturer: info.manufacturer,
        };
        log('Device info loaded:', state.deviceInfo);
    }
    catch (e) {
        log('Failed to load device info:', e);
        state.deviceInfo = {};
    }
}
/**
 * Get the platform for the MGM SDK.
 */
function getPlatform() {
    const platform = core_1.Capacitor.getPlatform();
    if (platform === 'ios')
        return 'ios';
    if (platform === 'android')
        return 'android';
    return 'web';
}
/**
 * Get device type based on platform.
 */
function getDeviceType() {
    const platform = core_1.Capacitor.getPlatform();
    if (platform === 'ios' || platform === 'android') {
        // Could use Device.getInfo() for more accuracy but that would be async
        return 'phone';
    }
    return 'desktop';
}
/**
 * Get OS version from device info.
 */
function getOSVersion() {
    return state.deviceInfo?.osVersion ?? 'unknown';
}
/**
 * MostlyGoodMetrics Capacitor SDK
 */
const MostlyGoodMetrics = {
    /**
     * Configure the SDK with an API key and optional settings.
     */
    configure(apiKey, config = {}) {
        // Check both our state and the underlying JS SDK
        if (state.isConfigured || javascript_1.MostlyGoodMetrics.isConfigured) {
            log('Already configured, skipping');
            return;
        }
        state.debugLogging = config.enableDebugLogging ?? false;
        log('Configuring with options:', config);
        // Create Capacitor Preferences-based storage
        const storage = new storage_1.CapacitorPreferencesStorage(config.maxStoredEvents);
        // Restore user ID from storage
        storage_1.persistence.getUserId().then((userId) => {
            if (userId) {
                log('Restored user ID:', userId);
            }
        });
        // Load device info async
        loadDeviceInfo().catch((e) => log('Device info error:', e));
        // Configure the JS SDK
        // Disable its built-in lifecycle tracking since we handle it ourselves
        javascript_1.MostlyGoodMetrics.configure({
            apiKey,
            ...config,
            storage,
            platform: getPlatform(),
            sdk: 'capacitor', // Use react-native type for now (need to update JS SDK types)
            sdkVersion: SDK_VERSION,
            osVersion: config.osVersion ?? getOSVersion(),
            trackAppLifecycleEvents: false, // We handle this with Capacitor App plugin
        });
        state.isConfigured = true;
        // Set up Capacitor lifecycle tracking
        if (config.trackAppLifecycleEvents !== false && App) {
            log('Setting up lifecycle tracking');
            // Remove any existing listener (in case of hot reload)
            if (state.appStateListener) {
                state.appStateListener.remove();
                state.appStateListener = null;
            }
            // Track initial app open
            trackLifecycleEvent(javascript_1.SystemEvents.APP_OPENED);
            // Track install/update
            trackInstallOrUpdate(config.appVersion).catch((e) => log('Install/update tracking error:', e));
            // Subscribe to app state changes
            App.addListener('appStateChange', ({ isActive }) => {
                handleAppStateChange(isActive);
            }).then((listener) => {
                state.appStateListener = listener;
            }).catch((e) => log('Failed to add appStateChange listener:', e));
        }
        else if (config.trackAppLifecycleEvents !== false) {
            // App plugin not available but lifecycle tracking enabled
            log('Warning: @capacitor/app not installed, lifecycle tracking disabled');
            // Still track initial open if JS SDK is running in browser
            if (getPlatform() === 'web') {
                trackLifecycleEvent(javascript_1.SystemEvents.APP_OPENED);
            }
        }
    },
    /**
     * Track an event with optional properties.
     */
    track(name, properties) {
        if (!state.isConfigured) {
            console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        // Add Capacitor specific properties
        const enrichedProperties = {
            [javascript_1.SystemProperties.DEVICE_TYPE]: getDeviceType(),
            $storage_type: (0, storage_1.getStorageType)(),
            ...properties,
        };
        // Add device model if available
        if (state.deviceInfo?.model) {
            enrichedProperties[javascript_1.SystemProperties.DEVICE_MODEL] = state.deviceInfo.model;
        }
        javascript_1.MostlyGoodMetrics.track(name, enrichedProperties);
    },
    /**
     * Identify a user.
     */
    identify(userId) {
        if (!state.isConfigured) {
            console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Identifying user:', userId);
        javascript_1.MostlyGoodMetrics.identify(userId);
        // Also persist to storage for restoration
        storage_1.persistence.setUserId(userId).catch((e) => log('Failed to persist user ID:', e));
    },
    /**
     * Clear the current user identity.
     */
    resetIdentity() {
        if (!state.isConfigured)
            return;
        log('Resetting identity');
        javascript_1.MostlyGoodMetrics.resetIdentity();
        storage_1.persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
    },
    /**
     * Manually flush pending events to the server.
     */
    flush() {
        if (!state.isConfigured)
            return;
        log('Flushing events');
        javascript_1.MostlyGoodMetrics.flush().catch((e) => log('Flush error:', e));
    },
    /**
     * Start a new session with a fresh session ID.
     */
    startNewSession() {
        if (!state.isConfigured)
            return;
        log('Starting new session');
        javascript_1.MostlyGoodMetrics.startNewSession();
    },
    /**
     * Clear all pending events without sending them.
     */
    clearPendingEvents() {
        if (!state.isConfigured)
            return;
        log('Clearing pending events');
        javascript_1.MostlyGoodMetrics.clearPendingEvents().catch((e) => log('Clear error:', e));
    },
    /**
     * Get the number of pending events.
     */
    async getPendingEventCount() {
        if (!state.isConfigured)
            return 0;
        return javascript_1.MostlyGoodMetrics.getPendingEventCount();
    },
    // Super Properties
    /**
     * Set a single super property that will be included with every event.
     */
    setSuperProperty(key, value) {
        if (!state.isConfigured) {
            console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Setting super property:', key);
        javascript_1.MostlyGoodMetrics.setSuperProperty(key, value);
    },
    /**
     * Set multiple super properties at once.
     */
    setSuperProperties(properties) {
        if (!state.isConfigured) {
            console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Setting super properties:', Object.keys(properties).join(', '));
        javascript_1.MostlyGoodMetrics.setSuperProperties(properties);
    },
    /**
     * Remove a single super property.
     */
    removeSuperProperty(key) {
        if (!state.isConfigured)
            return;
        log('Removing super property:', key);
        javascript_1.MostlyGoodMetrics.removeSuperProperty(key);
    },
    /**
     * Clear all super properties.
     */
    clearSuperProperties() {
        if (!state.isConfigured)
            return;
        log('Clearing all super properties');
        javascript_1.MostlyGoodMetrics.clearSuperProperties();
    },
    /**
     * Get all current super properties.
     */
    getSuperProperties() {
        if (!state.isConfigured)
            return {};
        return javascript_1.MostlyGoodMetrics.getSuperProperties();
    },
    /**
     * Clean up resources. Call when unmounting the app.
     */
    destroy() {
        if (state.appStateListener) {
            state.appStateListener.remove();
            state.appStateListener = null;
        }
        javascript_1.MostlyGoodMetrics.reset();
        state.isConfigured = false;
        state.lastLifecycleEvent = null;
        state.deviceInfo = null;
        log('Destroyed');
    },
};
exports.default = MostlyGoodMetrics;
