import { type MGMConfiguration, type EventProperties, type UserProfile } from '@mostly-good-metrics/javascript';
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
export interface CapacitorConfig extends Omit<MGMConfiguration, 'storage' | 'respectDoNotTrack' | 'persistence'> {
    /**
     * The app version string. Required for install/update tracking.
     */
    appVersion?: string;
    /**
     * Treat this first MGM launch as an existing installation: establishes the
     * lifecycle version baseline without emitting `$app_installed`. Set this
     * from a legacy analytics installation marker during a provider migration.
     * @default false
     */
    existingInstallation?: boolean;
    /**
     * Returns properties evaluated for every event. Dynamic properties override
     * super properties; event properties and MGM system properties win last.
     */
    contextProvider?: () => EventProperties;
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
 * MostlyGoodMetrics Capacitor SDK
 */
declare const MostlyGoodMetrics: {
    /**
     * Configure the SDK with an API key and optional settings.
     */
    configure(apiKey: string, config?: Omit<CapacitorConfig, "apiKey">): void;
    /**
     * Track an event with optional properties.
     */
    track(name: string, properties?: EventProperties): void;
    /**
     * Identify a user with optional profile data.
     * @param userId - The user's unique identifier
     * @param profile - Optional profile data including email and name
     */
    identify(userId: string, profile?: UserProfile): void;
    /**
     * Clear the current user identity.
     *
     * Pass `{ clearAnonymousId: true }` for a full "forget me": additionally
     * rotates the anonymous ID, purges queued (unsent) events, super
     * properties, identify debounce state, the cached experiment variants and
     * the sticky local experiment assignments (so the new anonymous ID is
     * re-bucketed). Requires @mostly-good-metrics/javascript >= 0.9.
     */
    resetIdentity(options?: ResetIdentityOptions): void;
    /**
     * Reset the anonymous ID to a newly generated one (persisted by the JS
     * core). Returns the new anonymous ID, or null when the SDK is not
     * configured or the installed core does not support it yet.
     * Requires @mostly-good-metrics/javascript >= 0.9.
     */
    resetAnonymousId(): string | null;
    /**
     * Opt out of all tracking.
     *
     * Immediately stops tracking (track/identify/flush become no-ops) and
     * purges queued (unsent) events. The choice is persisted in Capacitor
     * Preferences (native storage) so it survives app restarts even when
     * webview storage is cleared.
     */
    optOut(): void;
    /**
     * Opt back in to tracking. Persisted in Capacitor Preferences, overriding
     * `optedOutByDefault` on later launches.
     */
    optIn(): void;
    /**
     * Check whether tracking is currently opted out.
     */
    isOptedOut(): boolean;
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
    flush(): Promise<void>;
    /**
     * Start a new session with a fresh session ID.
     */
    startNewSession(): void;
    /**
     * Clear all pending events without sending them.
     */
    clearPendingEvents(): void;
    /**
     * Get the number of pending events.
     */
    getPendingEventCount(): Promise<number>;
    /**
     * Set a single super property that will be included with every event.
     */
    setSuperProperty(key: string, value: EventProperties[string]): void;
    /**
     * Set multiple super properties at once.
     */
    setSuperProperties(properties: EventProperties): void;
    /**
     * Remove a single super property.
     */
    removeSuperProperty(key: string): void;
    /**
     * Clear all super properties.
     */
    clearSuperProperties(): void;
    /**
     * Get all current super properties.
     */
    getSuperProperties(): EventProperties;
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
    getVariant(experimentName: string, fallback?: string | null): string | null;
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
    ready(timeoutMs?: number): Promise<void>;
    /**
     * Clean up resources. Call when unmounting the app.
     */
    destroy(): void;
};
export default MostlyGoodMetrics;
//# sourceMappingURL=index.d.ts.map