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
const SDK_VERSION = '0.2.0';

export type { MGMConfiguration, EventProperties, UserProfile };

/**
 * Options for resetIdentity().
 */
export interface ResetIdentityOptions {
  /**
   * Full "forget me": in addition to clearing the user ID, also rotate the
   * anonymous ID, purge queued (unsent) events, super properties, identify
   * debounce state and the cached experiment variants.
   * @default false
   */
  clearAnonymousId?: boolean;
}

/**
 * Note: `respectDoNotTrack` and `persistence` from the JS SDK are web-only
 * (browser Do Not Track signal and cookie/localStorage persistence modes) and
 * are intentionally not part of the Capacitor configuration. Opt-out state is
 * persisted in Capacitor Preferences (native storage) instead, so it survives
 * even when webview storage is cleared.
 */
export interface CapacitorConfig
  extends Omit<MGMConfiguration, 'storage' | 'respectDoNotTrack' | 'persistence'> {
  /**
   * The app version string. Required for install/update tracking.
   */
  appVersion?: string;

  /**
   * Start opted out of tracking until optIn() is called.
   * Useful for consent-first apps. A previously persisted opt-in/opt-out
   * choice (from optIn()/optOut()) takes precedence over this default.
   * @default false
   */
  optedOutByDefault?: boolean;

  /**
   * Collect device properties ($device_type/$device_model) and locale/timezone
   * context. Platform, OS version and app version are still sent when false.
   * @default true
   */
  collectDeviceProperties?: boolean;
}

/**
 * Privacy APIs introduced in @mostly-good-metrics/javascript 0.9.
 * Accessed through this structural type (with runtime guards) so the wrapper
 * compiles and degrades gracefully against older core versions until the
 * dependency is bumped.
 */
interface PrivacyCapableStatics {
  optOut?: () => void;
  optIn?: () => void;
  isOptedOut?: () => boolean;
  resetAnonymousId?: () => string | null;
  resetIdentity: (options?: ResetIdentityOptions) => void;
}

const PrivacyClient = MGMClient as unknown as PrivacyCapableStatics;

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
    } | null;
    optedOut: boolean;
    collectDeviceProperties: boolean;
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
    optedOut: false,
    collectDeviceProperties: true,
  };
}

const state = g.__MGM_CAPACITOR_STATE__;

// Backfill fields that may be missing when hot-reloading over an older SDK version
state.optedOut = state.optedOut ?? false;
state.collectDeviceProperties = state.collectDeviceProperties ?? true;

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
  if (state.optedOut) {
    log(`Tracking is opted out, skipping lifecycle event: ${eventName}`);
    return;
  }

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

    state.collectDeviceProperties = config.collectDeviceProperties ?? true;
    // Until the persisted choice is loaded, honor the configured default
    state.optedOut = config.optedOutByDefault ?? false;

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
    // Disable its built-in lifecycle tracking since we handle it ourselves.
    // `optedOutByDefault` starts the JS client in the configured opt-out
    // state; the persisted Preferences choice is applied right below. The
    // cast keeps this compiling against core typings that predate the
    // privacy controls (@mostly-good-metrics/javascript < 0.9).
    MGMClient.configure({
      apiKey,
      ...config,
      storage,
      optedOutByDefault: config.optedOutByDefault ?? false,
      platform: getPlatform(),
      sdk: 'capacitor' as 'react-native', // Use react-native type for now (need to update JS SDK types)
      sdkVersion: SDK_VERSION,
      osVersion: config.osVersion ?? getOSVersion(),
      trackAppLifecycleEvents: false, // We handle this with Capacitor App plugin
    } as MGMConfiguration);

    state.isConfigured = true;

    // Restore the persisted opt-out choice from Capacitor Preferences
    // (native storage), which survives even when webview storage is cleared.
    // An explicit persisted choice takes precedence over optedOutByDefault.
    const optOutRestore = persistence
      .getOptOut()
      .then((storedOptOut) => {
        if (storedOptOut === null) {
          return;
        }
        state.optedOut = storedOptOut;
        if (storedOptOut) {
          log('Tracking is disabled (opted out)');
          if (typeof PrivacyClient.optOut === 'function') {
            PrivacyClient.optOut();
          }
        } else if (typeof PrivacyClient.optIn === 'function') {
          PrivacyClient.optIn();
        }
      })
      .catch((e) => log('Failed to restore opt-out state:', e));

    // Set up Capacitor lifecycle tracking
    if (config.trackAppLifecycleEvents !== false && App) {
      log('Setting up lifecycle tracking');

      // Remove any existing listener (in case of hot reload)
      if (state.appStateListener) {
        state.appStateListener.remove();
        state.appStateListener = null;
      }

      // Track initial app open + install/update once the persisted opt-out
      // state has been restored, so opted-out launches stay silent
      optOutRestore.then(() => {
        trackLifecycleEvent(SystemEvents.APP_OPENED);
        trackInstallOrUpdate(config.appVersion).catch((e) => log('Install/update tracking error:', e));
      });

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
        optOutRestore.then(() => trackLifecycleEvent(SystemEvents.APP_OPENED));
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

    if (state.optedOut) {
      log(`Tracking is opted out, ignoring event: ${name}`);
      return;
    }

    // Add Capacitor specific properties
    const enrichedProperties: EventProperties = {
      ...(state.collectDeviceProperties
        ? { [SystemProperties.DEVICE_TYPE]: getDeviceType() }
        : {}),
      $storage_type: getStorageType(),
      ...properties,
    };

    // Add device model if available
    if (state.collectDeviceProperties && state.deviceInfo?.model) {
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

    if (state.optedOut) {
      log('Tracking is opted out, ignoring identify');
      return;
    }

    log('Identifying user:', userId, profile ? 'with profile' : '');
    MGMClient.identify(userId, profile);
    // Also persist to storage for restoration
    persistence.setUserId(userId).catch((e) => log('Failed to persist user ID:', e));
  },

  /**
   * Clear the current user identity.
   *
   * Pass `{ clearAnonymousId: true }` for a full "forget me": additionally
   * rotates the anonymous ID, purges queued (unsent) events, super
   * properties, identify debounce state and the cached experiment variants.
   * Requires @mostly-good-metrics/javascript >= 0.9.
   */
  resetIdentity(options?: ResetIdentityOptions): void {
    if (!state.isConfigured) return;

    log('Resetting identity', options ?? '');
    PrivacyClient.resetIdentity(options);
    persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
  },

  /**
   * Reset the anonymous ID to a newly generated one (persisted by the JS
   * core). Returns the new anonymous ID, or null when the SDK is not
   * configured or the installed core does not support it yet.
   * Requires @mostly-good-metrics/javascript >= 0.9.
   */
  resetAnonymousId(): string | null {
    if (!state.isConfigured) return null;

    if (typeof PrivacyClient.resetAnonymousId !== 'function') {
      console.warn(
        '[MostlyGoodMetrics] resetAnonymousId requires a newer @mostly-good-metrics/javascript core.'
      );
      return null;
    }

    log('Resetting anonymous ID');
    return PrivacyClient.resetAnonymousId();
  },

  /**
   * Opt out of all tracking.
   *
   * Immediately stops tracking (track/identify/flush become no-ops) and
   * purges queued (unsent) events. The choice is persisted in Capacitor
   * Preferences (native storage) so it survives app restarts even when
   * webview storage is cleared.
   */
  optOut(): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Opting out of tracking');
    state.optedOut = true;
    persistence.setOptOut(true).catch((e) => log('Failed to persist opt-out:', e));

    if (typeof PrivacyClient.optOut === 'function') {
      PrivacyClient.optOut();
    } else {
      // Older core: at least purge the queued events
      MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e));
    }
  },

  /**
   * Opt back in to tracking. Persisted in Capacitor Preferences, overriding
   * `optedOutByDefault` on later launches.
   */
  optIn(): void {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    log('Opting in to tracking');
    state.optedOut = false;
    persistence.setOptOut(false).catch((e) => log('Failed to persist opt-in:', e));

    if (typeof PrivacyClient.optIn === 'function') {
      PrivacyClient.optIn();
    }
  },

  /**
   * Check whether tracking is currently opted out.
   */
  isOptedOut(): boolean {
    if (!state.isConfigured) return false;
    return state.optedOut;
  },

  /**
   * Manually flush pending events to the server.
   */
  flush(): void {
    if (!state.isConfigured) return;

    if (state.optedOut) {
      log('Tracking is opted out, skipping flush');
      return;
    }

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
    state.optedOut = false;
    state.collectDeviceProperties = true;
    log('Destroyed');
  },
};

export default MostlyGoodMetrics;
