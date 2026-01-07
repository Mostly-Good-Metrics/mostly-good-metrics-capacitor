import { Capacitor } from '@capacitor/core';
import {
  MostlyGoodMetrics as MGMClient,
  type MGMConfiguration,
  type EventProperties,
  type Platform as MGMPlatform,
  type UserProfile,
  SystemEvents,
  SystemProperties,
} from '@mostly-good-metrics/javascript';
import { CapacitorPreferencesStorage, persistence, getStorageType } from './storage';

/** SDK version for metrics headers */
const SDK_VERSION = '0.1.1';

export type { MGMConfiguration, EventProperties, UserProfile };

export interface CapacitorConfig extends Omit<MGMConfiguration, 'storage'> {
  /**
   * The app version string. Required for install/update tracking.
   */
  appVersion?: string;
}

// Try to import Capacitor plugins, fall back to null if not available
let App: typeof import('@capacitor/app').App | null = null;
let Device: typeof import('@capacitor/device').Device | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  App = require('@capacitor/app').App;
} catch {
  // App plugin not installed
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Device = require('@capacitor/device').Device;
} catch {
  // Device plugin not installed
}

// Use global to persist state across hot reloads
const g = globalThis as typeof globalThis & {
  __MGM_CAPACITOR_STATE__?: {
    appStateListener: { remove: () => void } | null;
    isConfigured: boolean;
    isActive: boolean;
    debugLogging: boolean;
    lastLifecycleEvent: { name: string; time: number } | null;
    deviceInfo: {
      model?: string;
      osVersion?: string;
      manufacturer?: string;
    } | null;
  };
};

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

function log(...args: unknown[]) {
  if (state.debugLogging) {
    console.log('[MostlyGoodMetrics]', ...args);
  }
}

/**
 * Track a lifecycle event with deduplication.
 */
function trackLifecycleEvent(eventName: string, properties?: EventProperties) {
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
  MGMClient.track(eventName, properties);
}

/**
 * Handle app state changes for lifecycle tracking.
 */
function handleAppStateChange(isActive: boolean) {
  if (!MGMClient.shared) return;

  log(`AppState change: ${state.isActive ? 'active' : 'background'} -> ${isActive ? 'active' : 'background'}`);

  // App came to foreground
  if (!state.isActive && isActive) {
    trackLifecycleEvent(SystemEvents.APP_OPENED);
  }

  // App went to background
  if (state.isActive && !isActive) {
    trackLifecycleEvent(SystemEvents.APP_BACKGROUNDED);
    // Flush events when going to background
    MGMClient.flush().catch((e) => log('Flush error:', e));
  }

  state.isActive = isActive;
}

/**
 * Track app install or update events.
 */
async function trackInstallOrUpdate(appVersion?: string) {
  if (!appVersion) return;

  const previousVersion = await persistence.getAppVersion();
  const isFirst = await persistence.isFirstLaunch();

  if (isFirst) {
    trackLifecycleEvent(SystemEvents.APP_INSTALLED, {
      [SystemProperties.VERSION]: appVersion,
    });
    await persistence.setAppVersion(appVersion);
  } else if (previousVersion && previousVersion !== appVersion) {
    trackLifecycleEvent(SystemEvents.APP_UPDATED, {
      [SystemProperties.VERSION]: appVersion,
      [SystemProperties.PREVIOUS_VERSION]: previousVersion,
    });
    await persistence.setAppVersion(appVersion);
  } else if (!previousVersion) {
    await persistence.setAppVersion(appVersion);
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
  } catch (e) {
    log('Failed to load device info:', e);
    state.deviceInfo = {};
  }
}

/**
 * Get the platform for the MGM SDK.
 */
function getPlatform(): MGMPlatform {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'android';
  return 'web';
}

/**
 * Get device type based on platform.
 */
function getDeviceType(): string {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    // Could use Device.getInfo() for more accuracy but that would be async
    return 'phone';
  }
  return 'desktop';
}

/**
 * Get OS version from device info.
 */
function getOSVersion(): string {
  return state.deviceInfo?.osVersion ?? 'unknown';
}

/**
 * MostlyGoodMetrics Capacitor SDK
 */
const MostlyGoodMetrics = {
  /**
   * Configure the SDK with an API key and optional settings.
   */
  configure(apiKey: string, config: Omit<CapacitorConfig, 'apiKey'> = {}): void {
    // Check both our state and the underlying JS SDK
    if (state.isConfigured || MGMClient.isConfigured) {
      log('Already configured, skipping');
      return;
    }

    state.debugLogging = config.enableDebugLogging ?? false;
    log('Configuring with options:', config);

    // Create Capacitor Preferences-based storage
    const storage = new CapacitorPreferencesStorage(config.maxStoredEvents);

    // Restore user ID from storage
    persistence.getUserId().then((userId) => {
      if (userId) {
        log('Restored user ID:', userId);
      }
    });

    // Load device info async
    loadDeviceInfo().catch((e) => log('Device info error:', e));

    // Configure the JS SDK
    // Disable its built-in lifecycle tracking since we handle it ourselves
    MGMClient.configure({
      apiKey,
      ...config,
      storage,
      platform: getPlatform(),
      sdk: 'capacitor' as 'react-native', // Use react-native type for now (need to update JS SDK types)
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
      trackLifecycleEvent(SystemEvents.APP_OPENED);

      // Track install/update
      trackInstallOrUpdate(config.appVersion).catch((e) => log('Install/update tracking error:', e));

      // Subscribe to app state changes
      App.addListener('appStateChange', ({ isActive }) => {
        handleAppStateChange(isActive);
      }).then((listener) => {
        state.appStateListener = listener;
      }).catch((e) => log('Failed to add appStateChange listener:', e));
    } else if (config.trackAppLifecycleEvents !== false) {
      // App plugin not available but lifecycle tracking enabled
      log('Warning: @capacitor/app not installed, lifecycle tracking disabled');

      // Still track initial open if JS SDK is running in browser
      if (getPlatform() === 'web') {
        trackLifecycleEvent(SystemEvents.APP_OPENED);
      }
    }
  },

  /**
   * Track an event with optional properties.
   */
  track(name: string, properties?: EventProperties): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    // Add Capacitor specific properties
    const enrichedProperties: EventProperties = {
      [SystemProperties.DEVICE_TYPE]: getDeviceType(),
      $storage_type: getStorageType(),
      ...properties,
    };

    // Add device model if available
    if (state.deviceInfo?.model) {
      enrichedProperties[SystemProperties.DEVICE_MODEL] = state.deviceInfo.model;
    }

    MGMClient.track(name, enrichedProperties);
  },

  /**
   * Identify a user with optional profile data.
   * @param userId - The user's unique identifier
   * @param profile - Optional profile data including email and name
   */
  identify(userId: string, profile?: UserProfile): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Identifying user:', userId, profile ? 'with profile' : '');
    MGMClient.identify(userId, profile);
    // Also persist to storage for restoration
    persistence.setUserId(userId).catch((e) => log('Failed to persist user ID:', e));
  },

  /**
   * Clear the current user identity.
   */
  resetIdentity(): void {
    if (!state.isConfigured) return;

    log('Resetting identity');
    MGMClient.resetIdentity();
    persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
  },

  /**
   * Manually flush pending events to the server.
   */
  flush(): void {
    if (!state.isConfigured) return;

    log('Flushing events');
    MGMClient.flush().catch((e) => log('Flush error:', e));
  },

  /**
   * Start a new session with a fresh session ID.
   */
  startNewSession(): void {
    if (!state.isConfigured) return;

    log('Starting new session');
    MGMClient.startNewSession();
  },

  /**
   * Clear all pending events without sending them.
   */
  clearPendingEvents(): void {
    if (!state.isConfigured) return;

    log('Clearing pending events');
    MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e));
  },

  /**
   * Get the number of pending events.
   */
  async getPendingEventCount(): Promise<number> {
    if (!state.isConfigured) return 0;
    return MGMClient.getPendingEventCount();
  },

  // Super Properties

  /**
   * Set a single super property that will be included with every event.
   */
  setSuperProperty(key: string, value: EventProperties[string]): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super property:', key);
    MGMClient.setSuperProperty(key, value);
  },

  /**
   * Set multiple super properties at once.
   */
  setSuperProperties(properties: EventProperties): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }
    log('Setting super properties:', Object.keys(properties).join(', '));
    MGMClient.setSuperProperties(properties);
  },

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    if (!state.isConfigured) return;
    log('Removing super property:', key);
    MGMClient.removeSuperProperty(key);
  },

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    if (!state.isConfigured) return;
    log('Clearing all super properties');
    MGMClient.clearSuperProperties();
  },

  /**
   * Get all current super properties.
   */
  getSuperProperties(): EventProperties {
    if (!state.isConfigured) return {};
    return MGMClient.getSuperProperties();
  },

  /**
   * Clean up resources. Call when unmounting the app.
   */
  destroy(): void {
    if (state.appStateListener) {
      state.appStateListener.remove();
      state.appStateListener = null;
    }
    MGMClient.reset();
    state.isConfigured = false;
    state.lastLifecycleEvent = null;
    state.deviceInfo = null;
    log('Destroyed');
  },
};

export default MostlyGoodMetrics;
