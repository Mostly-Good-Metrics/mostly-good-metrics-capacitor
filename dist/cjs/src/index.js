"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const retention_1 = require("./retention");
const native_1 = require("./native");
const core_1 = require("@capacitor/core");
const javascript_1 = require("@mostly-good-metrics/javascript");
const storage_1 = require("./storage");
/** SDK version for metrics headers */
const SDK_VERSION = '0.2.0';
const PrivacyClient = javascript_1.MostlyGoodMetrics;
// Alias used by the experiment proxies below
const ExperimentClient = PrivacyClient;
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
        appStateRegistrationPending: false,
        appStateRemovalPending: false,
        lifecycleEnabled: true,
        isConfigured: false,
        isActive: true,
        debugLogging: false,
        lastLifecycleEvent: null,
        deviceInfo: null,
        optedOut: false,
        collectDeviceProperties: true,
        clientReady: false,
        pendingClientCalls: [],
        pendingClientBytes: 0,
        eventStorage: null,
        initPromise: null,
        initGeneration: 0,
        explicitConsent: null,
        cancelledWaits: new Set(),
    };
}
const state = g.__MGM_CAPACITOR_STATE__;
// Backfill fields that may be missing when hot-reloading over an older SDK version
state.optedOut = state.optedOut ?? false;
state.collectDeviceProperties = state.collectDeviceProperties ?? true;
state.clientReady = state.clientReady ?? false;
state.pendingClientCalls = state.pendingClientCalls ?? [];
state.pendingClientBytes = state.pendingClientBytes ?? 0;
state.eventStorage = state.eventStorage ?? null;
state.initPromise = state.initPromise ?? null;
state.initGeneration = state.initGeneration ?? 0;
state.explicitConsent = state.explicitConsent ?? null;
state.cancelledWaits = state.cancelledWaits ?? new Set();
state.appStateRegistrationPending = state.appStateRegistrationPending ?? false;
state.appStateRemovalPending = state.appStateRemovalPending ?? false;
state.lifecycleEnabled = state.lifecycleEnabled ?? true;
const DEDUPE_INTERVAL_MS = 1000; // Ignore duplicate events within 1 second
const MAX_PENDING_CLIENT_CALLS = 10000;
function normalizedTimeout(timeoutMs) {
    return Number.isFinite(timeoutMs) ? Math.min(2147483647, Math.max(0, timeoutMs)) : 5000;
}
async function waitForClient(timeoutMs = 5000) {
    const generation = state.initGeneration;
    let timer;
    let cancel;
    try {
        await Promise.race([
            Promise.resolve(state.initPromise),
            new Promise((resolve) => { cancel = resolve; state.cancelledWaits.add(resolve); }),
            new Promise((resolve) => { timer = setTimeout(resolve, normalizedTimeout(timeoutMs)); }),
        ]);
    }
    catch (error) {
        log('Initialization wait error:', error);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (cancel)
            state.cancelledWaits.delete(cancel);
    }
    return generation === state.initGeneration && state.isConfigured && state.clientReady;
}
async function waitUntilReady(timeoutMs) {
    const timeout = normalizedTimeout(timeoutMs);
    const generation = state.initGeneration;
    const started = Date.now();
    let timer;
    let cancel;
    try {
        await Promise.race([
            new Promise((resolve) => { cancel = resolve; state.cancelledWaits.add(resolve); }),
            (async () => {
                await state.initPromise;
                if (generation !== state.initGeneration || !state.isConfigured || !state.clientReady)
                    return;
                await ExperimentClient.ready?.(Math.max(0, timeout - (Date.now() - started)));
            })(),
            new Promise((resolve) => { timer = setTimeout(resolve, timeout); }),
        ]);
    }
    catch (error) {
        log('Readiness error:', error);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (cancel)
            state.cancelledWaits.delete(cancel);
    }
}
function warn(...args) {
    try {
        console.warn(...args);
    }
    catch {
        // Logging is best-effort, including unconfigured SDK warnings.
    }
}
function snapshotProperties(properties) {
    const snapshot = {};
    let bytes = 0;
    let keys = 0;
    try {
        for (const key in properties ?? {}) {
            if (++keys > 1024)
                break;
            if (!Object.prototype.hasOwnProperty.call(properties, key))
                continue;
            if (key.length > 255)
                continue;
            try {
                const owned = (0, retention_1.ownedSnapshot)(properties[key]);
                if (!owned || bytes + owned.bytes + key.length * 2 > 32 * 1024)
                    continue;
                bytes += owned.bytes + key.length * 2;
                Object.defineProperty(snapshot, key, { value: owned.value, enumerable: true, configurable: true, writable: true });
            }
            catch (e) {
                log('Unreadable event property:', e);
            }
        }
    }
    catch (e) {
        log('Unreadable event properties:', e);
    }
    return snapshot;
}
function invokeClient(fn) {
    try {
        fn();
    }
    catch (e) {
        log('Client call error:', e);
    }
}
function log(...args) {
    if (state.debugLogging) {
        try {
            console.log('[MostlyGoodMetrics]', ...args);
        }
        catch {
            // Host logging hooks must never interrupt analytics or error handling.
        }
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
function removeAppStateListener(listener) {
    if (state.appStateRemovalPending)
        return;
    state.appStateRemovalPending = true;
    try {
        // An uncancelable native removal must settle before another listener can
        // be registered. Failed removals stay quarantined: stale callbacks are
        // generation guarded and cannot retain a growing chain of registrations.
        void Promise.resolve(listener.remove()).then(() => {
            state.appStateRemovalPending = false;
            if (state.isConfigured && state.clientReady && state.lifecycleEnabled && !state.appStateListener)
                subscribeToAppState(state.initGeneration);
        }, (error) => log('Listener cleanup error:', error));
    }
    catch (error) {
        log('Listener cleanup error:', error);
    }
}
function subscribeToAppState(generation) {
    if (!App || state.appStateRegistrationPending || state.appStateRemovalPending || !state.isConfigured || !state.clientReady || !state.lifecycleEnabled)
        return;
    state.appStateRegistrationPending = true;
    const settled = () => {
        state.appStateRegistrationPending = false;
        if (generation !== state.initGeneration && state.isConfigured && state.lifecycleEnabled) {
            subscribeToAppState(state.initGeneration);
        }
    };
    try {
        void App.addListener('appStateChange', ({ isActive }) => {
            if (generation === state.initGeneration && state.isConfigured)
                handleAppStateChange(isActive);
        }).then((listener) => {
            if (generation !== state.initGeneration || !state.isConfigured || !state.lifecycleEnabled) {
                removeAppStateListener(listener);
            }
            else {
                state.appStateListener = listener;
            }
            settled();
        }, (error) => {
            log('Failed to add appStateChange listener:', error);
            settled();
        });
    }
    catch (error) {
        state.appStateRegistrationPending = false;
        log('Failed to add appStateChange listener:', error);
    }
}
function whenClientReady(fn, retainedBytes = 128) {
    if (state.clientReady) {
        invokeClient(fn);
        return;
    }
    if (retainedBytes > retention_1.MAX_RETAINED_BYTES)
        return;
    while (state.pendingClientCalls.length && (state.pendingClientCalls.length >= MAX_PENDING_CLIENT_CALLS || state.pendingClientBytes + retainedBytes > retention_1.MAX_RETAINED_BYTES)) {
        state.pendingClientBytes -= state.pendingClientCalls.shift()?.retainedBytes ?? 128;
    }
    const pending = () => invokeClient(fn);
    pending.retainedBytes = retainedBytes;
    state.pendingClientBytes += retainedBytes;
    state.pendingClientCalls.push(pending);
}
/**
 * Clear the sticky local experiment assignments (local enrollment mode) so a
 * rotated anonymous ID is re-bucketed. The JS core persists them in the
 * webview's localStorage (same context as this wrapper) and clears them
 * itself on newer releases; this direct clear also covers older cores that
 * predate the wiring.
 */
function clearLocalExperimentAssignments() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('mgm_local_experiment_assignments');
        }
    }
    catch (e) {
        log('Failed to clear local experiment assignments:', e);
    }
}
/**
 * Track a lifecycle event with deduplication.
 */
function trackLifecycleEvent(eventName, properties) {
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
    invokeClient(() => javascript_1.MostlyGoodMetrics.track(eventName, properties));
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
        void Promise.resolve().then(() => javascript_1.MostlyGoodMetrics.flush()).catch((e) => log('Flush error:', e));
    }
    state.isActive = isActive;
}
/**
 * Track app install or update events.
 */
async function trackInstallOrUpdate(appVersion, existingInstallation = false) {
    if (!appVersion)
        return;
    const generation = state.initGeneration;
    const previousVersion = await storage_1.persistence.getAppVersion();
    const isFirst = await storage_1.persistence.isFirstLaunch();
    if (generation !== state.initGeneration || !state.isConfigured)
        return;
    if (isFirst) {
        if (!existingInstallation) {
            trackLifecycleEvent(javascript_1.SystemEvents.APP_INSTALLED, {
                [javascript_1.SystemProperties.VERSION]: appVersion,
            });
        }
        else {
            log('Existing installation: baselining lifecycle version without $app_installed');
        }
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
    const generation = state.initGeneration;
    if (!Device) {
        state.deviceInfo = {};
        return;
    }
    try {
        const info = await (0, native_1.withNativeDeadline)(() => Device.getInfo());
        if (generation !== state.initGeneration || !state.isConfigured)
            return;
        state.deviceInfo = {
            model: info.model,
            osVersion: info.osVersion,
        };
        log('Device info loaded:', state.deviceInfo);
    }
    catch (e) {
        log('Failed to load device info:', e);
        if (generation === state.initGeneration && state.isConfigured)
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
        if (state.eventStorage)
            (0, storage_1.invalidateEventStorage)(state.eventStorage);
        state.eventStorage = null;
        state.debugLogging = config.enableDebugLogging ?? false;
        log('Configuring with options:', config);
        state.collectDeviceProperties = config.collectDeviceProperties ?? true;
        state.lifecycleEnabled = config.trackAppLifecycleEvents !== false;
        // Until the persisted choice is loaded, honor the configured default
        state.optedOut = config.optedOutByDefault ?? false;
        state.isConfigured = true;
        state.clientReady = false;
        const generation = ++state.initGeneration;
        state.explicitConsent = null;
        // Create Capacitor Preferences-based storage
        const storage = new storage_1.CapacitorPreferencesStorage(config.maxStoredEvents);
        state.eventStorage = storage;
        state.initPromise = (async () => {
            // Resolve the persisted opt-out choice (Capacitor Preferences - native
            // storage that survives webview storage clears) BEFORE constructing
            // the JS client, so its experiments initialization - including
            // local-mode config fetches - starts in the correct opt-out state.
            // An explicit persisted choice takes precedence over optedOutByDefault.
            // Resolve the Preferences-backed anonymous ID too (see getOrCreateAnonymousId).
            const [storedOptOut, storedUserId, anonymousId] = await Promise.all([
                storage_1.persistence.getOptOut().catch(() => null),
                storage_1.persistence.getUserId().catch(() => null),
                storage_1.persistence
                    .getOrCreateAnonymousId(config.anonymousId, () => {
                    if (generation !== state.initGeneration || !state.isConfigured)
                        throw new Error('Configuration invalidated');
                    return (0, javascript_1.generateAnonymousId)();
                })
                    .catch(() => config.anonymousId),
                loadDeviceInfo().catch((e) => log('Device info error:', e)),
            ]);
            // destroy() invalidates work still waiting on native storage/plugins.
            if (generation !== state.initGeneration || !state.isConfigured)
                return;
            state.optedOut = state.explicitConsent ?? storedOptOut ?? config.optedOutByDefault ?? false;
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
            javascript_1.MostlyGoodMetrics.configure({
                apiKey,
                ...config,
                anonymousId,
                storage,
                optedOutByDefault: state.optedOut,
                platform: getPlatform(),
                sdk: 'capacitor', // Use react-native type for now (need to update JS SDK types)
                sdkVersion: SDK_VERSION,
                osVersion: config.osVersion ?? getOSVersion(),
                trackAppLifecycleEvents: false, // We handle this with Capacitor App plugin
            });
            // Native consent is authoritative even if WebView storage has an older choice.
            invokeClient(() => {
                if (state.optedOut && typeof PrivacyClient.optOut === 'function')
                    PrivacyClient.optOut();
                else if (!state.optedOut && typeof PrivacyClient.optIn === 'function')
                    PrivacyClient.optIn();
            });
            if (storedUserId)
                javascript_1.MostlyGoodMetrics.identify(storedUserId);
            // Replay any calls queued while the opt-out state was being resolved
            state.clientReady = true;
            const pendingCalls = state.pendingClientCalls.splice(0);
            state.pendingClientBytes = 0;
            pendingCalls.forEach((fn) => {
                if (generation === state.initGeneration && state.isConfigured)
                    fn();
            });
            if (generation !== state.initGeneration || !state.isConfigured)
                return;
            // Set up Capacitor lifecycle tracking. The client exists and the
            // opt-out state is resolved, so opted-out launches stay silent.
            if (config.trackAppLifecycleEvents !== false && App) {
                log('Setting up lifecycle tracking');
                // Remove any existing listener (in case of hot reload)
                if (state.appStateListener) {
                    removeAppStateListener(state.appStateListener);
                    state.appStateListener = null;
                }
                // Track initial app open
                trackLifecycleEvent(javascript_1.SystemEvents.APP_OPENED);
                if (generation !== state.initGeneration || !state.isConfigured)
                    return;
                // Track install/update
                trackInstallOrUpdate(config.appVersion, config.existingInstallation).catch((e) => log('Install/update tracking error:', e));
                subscribeToAppState(generation);
            }
            else if (config.trackAppLifecycleEvents !== false) {
                // App plugin not available but lifecycle tracking enabled
                log('Warning: @capacitor/app not installed, lifecycle tracking disabled');
                // Still track initial open if JS SDK is running in browser
                if (getPlatform() === 'web') {
                    trackLifecycleEvent(javascript_1.SystemEvents.APP_OPENED);
                    if (generation !== state.initGeneration || !state.isConfigured)
                        return;
                }
            }
        })().catch((e) => {
            log('Configuration error:', e);
            if (generation === state.initGeneration && !state.clientReady) {
                state.isConfigured = false;
                state.pendingClientCalls = [];
                state.pendingClientBytes = 0;
                for (const cancel of state.cancelledWaits)
                    cancel();
                state.cancelledWaits.clear();
            }
        });
    },
    /**
     * Track an event with optional properties.
     */
    track(name, properties) {
        if (typeof name !== 'string' || name.length > 255)
            return;
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        if (state.optedOut) {
            log(`Tracking is opted out, ignoring event: ${name}`);
            return;
        }
        // Add Capacitor specific properties
        const enrichedProperties = {
            ...(state.collectDeviceProperties
                ? { [javascript_1.SystemProperties.DEVICE_TYPE]: getDeviceType() }
                : {}),
            $storage_type: (0, storage_1.getStorageType)(),
            ...snapshotProperties(properties),
        };
        // Add device model if available
        if (state.collectDeviceProperties && state.deviceInfo?.model) {
            enrichedProperties[javascript_1.SystemProperties.DEVICE_MODEL] = state.deviceInfo.model;
        }
        const snapshot = (0, retention_1.ownedSnapshot)({ name, properties: enrichedProperties });
        if (!snapshot)
            return;
        whenClientReady(() => javascript_1.MostlyGoodMetrics.track(snapshot.value.name, snapshot.value.properties), snapshot.bytes + 128);
    },
    /**
     * Identify a user with optional profile data.
     * @param userId - The user's unique identifier
     * @param profile - Optional profile data including email and name
     */
    identify(userId, profile) {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        if (state.optedOut) {
            log('Tracking is opted out, ignoring identify');
            return;
        }
        log('Identifying user:', userId, profile ? 'with profile' : '');
        const snapshot = (0, retention_1.ownedSnapshot)({ userId, profile });
        if (!snapshot || typeof userId !== 'string')
            return;
        whenClientReady(() => javascript_1.MostlyGoodMetrics.identify(snapshot.value.userId, snapshot.value.profile), snapshot.bytes + 128);
        // Also persist to storage for restoration
        storage_1.persistence.setUserId(snapshot.value.userId).catch((e) => log('Failed to persist user ID:', e));
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
    resetIdentity(options) {
        if (!state.isConfigured)
            return;
        const snapshot = (0, retention_1.ownedSnapshot)(options ?? {});
        if (!snapshot)
            return;
        options = options === undefined ? undefined : snapshot.value;
        log('Resetting identity', options);
        whenClientReady(() => {
            PrivacyClient.resetIdentity(options);
            if (options?.clearAnonymousId) {
                // Persist the rotated anonymous ID so it survives app restarts.
                const newAnonymousId = javascript_1.MostlyGoodMetrics.shared?.anonymousId;
                if (newAnonymousId) {
                    storage_1.persistence
                        .setAnonymousId(newAnonymousId)
                        .catch((e) => log('Failed to persist anonymous ID:', e));
                }
                // The new anonymous ID must be re-bucketed for local experiments
                clearLocalExperimentAssignments();
            }
        }, snapshot.bytes + 128);
        storage_1.persistence.setUserId(null).catch((e) => log('Failed to clear user ID:', e));
    },
    /**
     * Reset the anonymous ID to a newly generated one (persisted by the JS
     * core). Returns the new anonymous ID, or null when the SDK is not
     * configured or the installed core does not support it yet.
     * Requires @mostly-good-metrics/javascript >= 0.9.
     */
    resetAnonymousId() {
        if (!state.isConfigured)
            return null;
        if (typeof PrivacyClient.resetAnonymousId !== 'function') {
            warn('[MostlyGoodMetrics] resetAnonymousId requires a newer @mostly-good-metrics/javascript core.');
            return null;
        }
        log('Resetting anonymous ID');
        let newAnonymousId;
        try {
            newAnonymousId = PrivacyClient.resetAnonymousId();
        }
        catch (error) {
            log('Anonymous ID error:', error);
            return null;
        }
        if (newAnonymousId) {
            // Persist the rotated ID so getOrCreateAnonymousId() reuses it next launch.
            storage_1.persistence
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
    optOut() {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Opting out of tracking');
        state.optedOut = true;
        state.explicitConsent = true;
        state.pendingClientCalls = [];
        state.pendingClientBytes = 0;
        storage_1.persistence.setOptOut(true).catch((e) => log('Failed to persist opt-out:', e));
        whenClientReady(() => {
            if (typeof PrivacyClient.optOut === 'function') {
                PrivacyClient.optOut();
            }
            else {
                // Older core: at least purge the queued events
                javascript_1.MostlyGoodMetrics.clearPendingEvents().catch((e) => log('Clear error:', e));
            }
        });
    },
    /**
     * Opt back in to tracking. Persisted in Capacitor Preferences, overriding
     * `optedOutByDefault` on later launches.
     */
    optIn() {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Opting in to tracking');
        state.optedOut = false;
        state.explicitConsent = false;
        storage_1.persistence.setOptOut(false).catch((e) => log('Failed to persist opt-in:', e));
        whenClientReady(() => {
            if (typeof PrivacyClient.optIn === 'function') {
                PrivacyClient.optIn();
            }
        });
    },
    /**
     * Check whether tracking is currently opted out.
     */
    isOptedOut() {
        if (!state.isConfigured)
            return false;
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
    async flush() {
        if (!state.isConfigured || state.optedOut)
            return;
        const generation = state.initGeneration;
        if (!await waitForClient() || state.optedOut || generation !== state.initGeneration)
            return;
        await Promise.resolve().then(() => {
            if (generation === state.initGeneration && state.isConfigured && !state.optedOut)
                return javascript_1.MostlyGoodMetrics.flush();
            return undefined;
        }).catch((e) => log('Flush error:', e));
    },
    /**
     * Start a new session with a fresh session ID.
     */
    startNewSession() {
        if (!state.isConfigured)
            return;
        log('Starting new session');
        whenClientReady(() => javascript_1.MostlyGoodMetrics.startNewSession());
    },
    /**
     * Clear all pending events without sending them.
     */
    clearPendingEvents() {
        if (!state.isConfigured)
            return;
        log('Clearing pending events');
        whenClientReady(() => javascript_1.MostlyGoodMetrics.clearPendingEvents().catch((e) => log('Clear error:', e)));
    },
    /**
     * Get the number of pending events.
     */
    async getPendingEventCount() {
        if (!state.isConfigured)
            return 0;
        const generation = state.initGeneration;
        if (!await waitForClient() || generation !== state.initGeneration)
            return 0;
        return javascript_1.MostlyGoodMetrics.getPendingEventCount();
    },
    // Super Properties
    /**
     * Set a single super property that will be included with every event.
     */
    setSuperProperty(key, value) {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Setting super property:', key);
        const snapshot = (0, retention_1.ownedSnapshot)({ key, value });
        if (!snapshot)
            return;
        whenClientReady(() => javascript_1.MostlyGoodMetrics.setSuperProperty(snapshot.value.key, snapshot.value.value), snapshot.bytes + 128);
    },
    /**
     * Set multiple super properties at once.
     */
    setSuperProperties(properties) {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return;
        }
        log('Setting super properties');
        const snapshot = (0, retention_1.ownedSnapshot)(properties);
        if (!snapshot)
            return;
        whenClientReady(() => javascript_1.MostlyGoodMetrics.setSuperProperties(snapshot.value), snapshot.bytes + 128);
    },
    /**
     * Remove a single super property.
     */
    removeSuperProperty(key) {
        if (!state.isConfigured)
            return;
        log('Removing super property:', key);
        const snapshot = (0, retention_1.ownedSnapshot)(key);
        if (!snapshot)
            return;
        whenClientReady(() => javascript_1.MostlyGoodMetrics.removeSuperProperty(snapshot.value), snapshot.bytes + 128);
    },
    /**
     * Clear all super properties.
     */
    clearSuperProperties() {
        if (!state.isConfigured)
            return;
        log('Clearing all super properties');
        whenClientReady(() => javascript_1.MostlyGoodMetrics.clearSuperProperties());
    },
    /**
     * Get all current super properties.
     */
    getSuperProperties() {
        if (!state.isConfigured || !state.clientReady)
            return {};
        try {
            return javascript_1.MostlyGoodMetrics.getSuperProperties();
        }
        catch (error) {
            log('Super properties error:', error);
            return {};
        }
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
    getVariant(experimentName, fallback = null) {
        if (!state.isConfigured) {
            warn('[MostlyGoodMetrics] SDK not configured. Call configure() first.');
            return fallback;
        }
        if (typeof ExperimentClient.getVariant !== 'function') {
            warn('[MostlyGoodMetrics] getVariant requires a newer @mostly-good-metrics/javascript core.');
            return fallback;
        }
        log('Getting variant for experiment:', experimentName);
        if (!state.clientReady)
            return fallback;
        try {
            return ExperimentClient.getVariant(experimentName, fallback);
        }
        catch (error) {
            log('Variant error:', error);
            return fallback;
        }
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
    async ready(timeoutMs = 5000) {
        if (!state.isConfigured)
            return;
        await waitUntilReady(timeoutMs);
    },
    /**
     * Clean up resources. Call when unmounting the app.
     */
    destroy() {
        if (state.eventStorage)
            (0, storage_1.invalidateEventStorage)(state.eventStorage);
        state.eventStorage = null;
        ++state.initGeneration;
        for (const cancel of state.cancelledWaits)
            cancel();
        state.cancelledWaits.clear();
        if (state.appStateListener) {
            removeAppStateListener(state.appStateListener);
            state.appStateListener = null;
        }
        invokeClient(() => javascript_1.MostlyGoodMetrics.reset());
        state.isConfigured = false;
        state.lastLifecycleEvent = null;
        state.deviceInfo = null;
        state.optedOut = false;
        state.collectDeviceProperties = true;
        state.clientReady = false;
        state.pendingClientCalls = [];
        state.pendingClientBytes = 0;
        state.initPromise = null;
        state.explicitConsent = null;
        log('Destroyed');
    },
};
exports.default = MostlyGoodMetrics;
