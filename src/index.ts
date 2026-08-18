import { Capacitor } from '@capacitor/core';
import {
  MostlyGoodMetrics as MGMClient,
  type MGMConfiguration,
  type EventProperties,
  type Platform as MGMPlatform,
  type UserProfile,
  SystemEvents,
  SystemProperties,
  generateAnonymousId,
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
   * debounce state, the cached experiment variants and the sticky local
   * experiment assignments (so the new anonymous ID is re-bucketed).
   * @default false
   */
  clearAnonymousId?: boolean;
}

/**
 * How experiment variants are assigned.
 * Mirrors the JS core's ExperimentMode (declared locally until the wrapper's
 * @mostly-good-metrics/javascript dependency is bumped to a release that
 * exports it).
 */
export type ExperimentMode = 'server' | 'local';

/**
 * An experiment configuration used for local (on-device) enrollment.
 * Mirrors the JS core's MGMExperimentConfig.
 */
export interface MGMExperimentConfig {
  /**
   * The experiment UUID (stable bucketing key, matching the dashboard).
   */
  id: string;

  /**
   * The human-readable experiment name passed to getVariant().
   */
  name: string;

  /**
   * The ordered list of variants. Order matters for bucketing.
   */
  variants: string[];
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

  /**
   * How experiment variants are assigned:
   * - 'server' (default): the server assigns variants per user.
   * - 'local': experiment configs are loaded without sending any user
   *   identifier and variants are assigned on-device via deterministic
   *   hashing. Sticky assignments are persisted by the JS core in the
   *   webview's localStorage.
   * Requires a @mostly-good-metrics/javascript release with experiment
   * support at runtime.
   * @default 'server'
   */
  experimentMode?: ExperimentMode;

  /**
   * Inline experiment configurations for experimentMode: 'local'.
   * When provided, the SDK performs no experiments network request at all.
   */
  localExperiments?: MGMExperimentConfig[];
}

/**
 * Privacy and experiment APIs introduced in newer
 * @mostly-good-metrics/javascript releases. Accessed through this structural
 * type (with runtime guards) so the wrapper compiles and degrades gracefully
 * against older core versions until the dependency is bumped.
 */
interface PrivacyCapableStatics {
  optOut?: () => void;
  optIn?: () => void;
  isOptedOut?: () => boolean;
  resetAnonymousId?: () => string | null;
  resetIdentity: (options?: ResetIdentityOptions) => void;
  getVariant?: (experimentName: string, fallback?: string | null) => string | null;
  ready?: (timeoutMs?: number) => Promise<void>;
}

const PrivacyClient = MGMClient as unknown as PrivacyCapableStatics;

// Alias used by the experiment proxies below
const ExperimentClient = PrivacyClient;

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
    clientReady: boolean;
    pendingClientCalls: Array<() => void>;
    initPromise: Promise<void> | null;
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
    clientReady: false,
    pendingClientCalls: [],
    initPromise: null,
  };
}

const state = g.__MGM_CAPACITOR_STATE__;

// Backfill fields that may be missing when hot-reloading over an older SDK version
state.optedOut = state.optedOut ?? false;
state.collectDeviceProperties = state.collectDeviceProperties ?? true;
state.clientReady = state.clientReady ?? false;
state.pendingClientCalls = state.pendingClientCalls ?? [];
state.initPromise = state.initPromise ?? null;

const DEDUPE_INTERVAL_MS = 1000; // Ignore duplicate events within 1 second

function log(...args: unknown[]) {
  if (state.debugLogging) {
    console.log('[MostlyGoodMetrics]', ...args);
  }
}

/**
 * Run a JS-client call now if the client has been constructed, otherwise
 * queue it to run (in order) as soon as configuration finishes.
 *
 * configure() resolves the persisted opt-out choice from Capacitor
 * Preferences BEFORE constructing the JS client, so there is a short async
 * window where the wrapper is "configured" but the JS client does not exist
 * yet. Calls made in that window would otherwise be dropped silently.
 */
function whenClientReady(fn: () => void): void {
  if (state.clientReady) {
    fn();
    return;
  }
  state.pendingClientCalls.push(fn);
}

/**
 * Clear the sticky local experiment assignments (local enrollment mode) so a
 * rotated anonymous ID is re-bucketed. The JS core persists them in the
 * webview's localStorage (same context as this wrapper) and clears them
 * itself on newer releases; this direct clear also covers older cores that
 * predate the wiring.
 */
function clearLocalExperimentAssignments(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('mgm_local_experiment_assignments');
    }
  } catch (e) {
    log('Failed to clear local experiment assignments:', e);
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

    state.isConfigured = true;
    state.clientReady = false;

    // Create Capacitor Preferences-based storage
    const storage = new CapacitorPreferencesStorage(config.maxStoredEvents);

    state.initPromise = (async () => {
      // Resolve the persisted opt-out choice (Capacitor Preferences - native
      // storage that survives webview storage clears) BEFORE constructing
      // the JS client, so its experiments initialization - including
      // local-mode config fetches - starts in the correct opt-out state.
      // An explicit persisted choice takes precedence over optedOutByDefault.
      // Resolve the Preferences-backed anonymous ID too (see getOrCreateAnonymousId).
      const [storedOptOut, storedUserId, anonymousId] = await Promise.all([
        persistence.getOptOut().catch(() => null),
        persistence.getUserId().catch(() => null),
        persistence
          .getOrCreateAnonymousId(config.anonymousId, generateAnonymousId)
          .catch(() => config.anonymousId),
        loadDeviceInfo().catch((e) => log('Device info error:', e)),
      ]);
      state.optedOut = storedOptOut ?? config.optedOutByDefault ?? false;
      log('Resolved anonymous ID:', anonymousId);
      if (state.optedOut) {
        log('Tracking is disabled (opted out)');
      }

      if (storedUserId) {
        log('Restored user ID:', storedUserId);
      }

      // Configure the JS SDK
      // Disable its built-in lifecycle tracking since we handle it ourselves.
      // `optedOutByDefault` starts the JS client in the resolved opt-out
      // state. The cast keeps this compiling against core typings that
      // predate the privacy controls (@mostly-good-metrics/javascript < 0.9).
      MGMClient.configure({
        apiKey,
        ...config,
        anonymousId,
        storage,
        optedOutByDefault: state.optedOut,
        platform: getPlatform(),
        sdk: 'capacitor' as 'react-native', // Use react-native type for now (need to update JS SDK types)
        sdkVersion: SDK_VERSION,
        osVersion: config.osVersion ?? getOSVersion(),
        trackAppLifecycleEvents: false, // We handle this with Capacitor App plugin
      } as MGMConfiguration);

      // Replay any calls queued while the opt-out state was being resolved
      state.clientReady = true;
      const pendingCalls = state.pendingClientCalls.splice(0);
      pendingCalls.forEach((fn) => fn());

      // Set up Capacitor lifecycle tracking. The client exists and the
      // opt-out state is resolved, so opted-out launches stay silent.
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
    })().catch((e) => {
      log('Configuration error:', e);
    });
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

    whenClientReady(() => MGMClient.track(name, enrichedProperties));
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
    whenClientReady(() => MGMClient.identify(userId, profile));
    // Also persist to storage for restoration
    persistence.setUserId(userId).catch((e) => log('Failed to persist user ID:', e));
  },

  /**
   * Clear the current user identity.
   *
   * Pass `{ clearAnonymousId: true }` for a full "forget me": additionally
   * rotates the anonymous ID, purges queued (unsent) events, super
   * properties, identify debounce state, the cached experiment variants and
   * the sticky local experiment assignments (so the new anonymous ID is
   * re-bucketed). Requires @mostly-good-metrics/javascript >= 0.9.
   */
  resetIdentity(options?: ResetIdentityOptions): void {
    if (!state.isConfigured) return;

    log('Resetting identity', options ?? '');
    whenClientReady(() => {
      PrivacyClient.resetIdentity(options);

      if (options?.clearAnonymousId) {
        // Persist the rotated anonymous ID so it survives app restarts.
        const newAnonymousId = MGMClient.shared?.anonymousId;
        if (newAnonymousId) {
          persistence
            .setAnonymousId(newAnonymousId)
            .catch((e) => log('Failed to persist anonymous ID:', e));
        }
        // The new anonymous ID must be re-bucketed for local experiments
        clearLocalExperimentAssignments();
      }
    });
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
    const newAnonymousId = PrivacyClient.resetAnonymousId();
    if (newAnonymousId) {
      // Persist the rotated ID so getOrCreateAnonymousId() reuses it next launch.
      persistence
        .setAnonymousId(newAnonymousId)
        .catch((e) => log('Failed to persist anonymous ID:', e));
    }
    // The new anonymous ID must be re-bucketed for local experiments
    clearLocalExperimentAssignments();
    return newAnonymousId;
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

    whenClientReady(() => {
      if (typeof PrivacyClient.optOut === 'function') {
        PrivacyClient.optOut();
      } else {
        // Older core: at least purge the queued events
        MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e));
      }
    });
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

    whenClientReady(() => {
      if (typeof PrivacyClient.optIn === 'function') {
        PrivacyClient.optIn();
      }
    });
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
   *
   * Returns a promise that resolves once the underlying flush completes (the
   * POST has been sent), so callers can `await flush()` before the app exits.
   * Resolves immediately (without flushing) when the SDK is not configured or
   * tracking is opted out. Errors are swallowed and logged, matching the
   * fire-and-forget lifecycle flushes, so the returned promise never rejects.
   * Also resolves (without flushing) if configure()/init fails to construct the
   * client, so an `await flush()` caller can never hang.
   */
  flush(): Promise<void> {
    if (!state.isConfigured) return Promise.resolve();

    if (state.optedOut) {
      log('Tracking is opted out, skipping flush');
      return Promise.resolve();
    }

    log('Flushing events');
    // If the JS client isn't constructed yet, the flush is queued and runs once
    // init finishes; chain the returned promise onto that so awaiting callers
    // still resolve after the deferred flush completes.
    return new Promise<void>((resolve) => {
      whenClientReady(() => {
        MGMClient.flush()
          .catch((e) => log('Flush error:', e))
          .finally(() => resolve());
      });
      // Safety net: if configure()/init fails, the client never becomes ready
      // and the queued flush above would never run, hanging an `await flush()`
      // caller. initPromise always settles (its own catch swallows errors), so
      // once it does, resolve if the client still isn't ready. resolve() is
      // idempotent, so this is a no-op on the normal (client-ready) path.
      Promise.resolve(state.initPromise).finally(() => {
        if (!state.clientReady) resolve();
      });
    });
  },

  /**
   * Start a new session with a fresh session ID.
   */
  startNewSession(): void {
    if (!state.isConfigured) return;

    log('Starting new session');
    whenClientReady(() => MGMClient.startNewSession());
  },

  /**
   * Clear all pending events without sending them.
   */
  clearPendingEvents(): void {
    if (!state.isConfigured) return;

    log('Clearing pending events');
    whenClientReady(() => MGMClient.clearPendingEvents().catch((e) => log('Clear error:', e)));
  },

  /**
   * Get the number of pending events.
   */
  async getPendingEventCount(): Promise<number> {
    if (!state.isConfigured) return 0;
    await state.initPromise;
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
    whenClientReady(() => MGMClient.setSuperProperty(key, value));
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
    whenClientReady(() => MGMClient.setSuperProperties(properties));
  },

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    if (!state.isConfigured) return;
    log('Removing super property:', key);
    whenClientReady(() => MGMClient.removeSuperProperty(key));
  },

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    if (!state.isConfigured) return;
    log('Clearing all super properties');
    whenClientReady(() => MGMClient.clearSuperProperties());
  },

  /**
   * Get all current super properties.
   */
  getSuperProperties(): EventProperties {
    if (!state.isConfigured) return {};
    return MGMClient.getSuperProperties();
  },

  // A/B Testing

  /**
   * Get the variant for an experiment.
   *
   * In 'server' mode variants are assigned server-side; in 'local' mode they
   * are assigned on-device via deterministic hashing (see the
   * `experimentMode` configuration option). On a hit, the variant is set as
   * a super property and a $experiment_exposure event is tracked once per
   * (user, experiment, variant).
   *
   * Returns `fallback` (default null) if the experiment is unknown or
   * experiments have not loaded yet. Await ready() first to ensure
   * experiments are loaded.
   */
  getVariant(experimentName: string, fallback: string | null = null): string | null {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return fallback;
    }

    if (typeof ExperimentClient.getVariant !== 'function') {
      console.warn(
        '[MostlyGoodMetrics] getVariant requires a newer @mostly-good-metrics/javascript core.'
      );
      return fallback;
    }

    log('Getting variant for experiment:', experimentName);
    return ExperimentClient.getVariant(experimentName, fallback);
  },

  /**
   * Wait for experiments to be loaded (resolves immediately when inline
   * localExperiments are configured or the cache is hydrated).
   * Call this before getVariant() to ensure experiments are loaded.
   *
   * Resolves as soon as experiments are ready, or after `timeoutMs`
   * (default 5000ms) elapses - whichever comes first - so it always
   * resolves. This mirrors the native SDKs' bounded ready() (Swift
   * `ready(timeout: 5.0)`, Android `ready(5000L)`).
   *
   * @param timeoutMs Maximum time to wait in milliseconds (default 5000)
   */
  async ready(timeoutMs: number = 5000): Promise<void> {
    if (!state.isConfigured) {
      console.warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
      return;
    }

    // Wait for opt-out resolution + JS client construction first, so
    // ready() never resolves before the client even exists.
    await state.initPromise;

    if (typeof ExperimentClient.ready !== 'function') {
      return;
    }

    log('Waiting for SDK to be ready');
    return ExperimentClient.ready(timeoutMs);
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
    state.clientReady = false;
    state.pendingClientCalls = [];
    state.initPromise = null;
    log('Destroyed');
  },
};

export default MostlyGoodMetrics;
