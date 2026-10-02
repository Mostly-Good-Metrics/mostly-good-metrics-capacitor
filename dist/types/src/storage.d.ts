import type { IEventStorage, MGMEvent } from '@mostly-good-metrics/javascript';
/**
 * Returns the storage type being used.
 */
export declare function getStorageType(): 'persistent' | 'memory';
/**
 * Event storage for Capacitor.
 * Uses Capacitor Preferences if available, otherwise falls back to in-memory storage.
 */
export declare class CapacitorPreferencesStorage implements IEventStorage {
    private maxEvents;
    private events;
    private opChain;
    private pendingSave;
    private resolvePendingSave;
    private rejectPendingSave;
    private saveTimer;
    constructor(maxEvents?: number);
    /**
     * Run an operation after all previously enqueued operations complete, so the
     * read-modify-write sequence inside each op is atomic with respect to the
     * others. A failed op does not wedge the queue.
     */
    private enqueue;
    private loadEvents;
    private saveEvents;
    private scheduleSave;
    private startPendingSave;
    private cancelPendingSave;
    store(event: MGMEvent): Promise<void>;
    fetchEvents(limit: number): Promise<MGMEvent[]>;
    removeEvents(count: number, clientEventIds?: string[]): Promise<void>;
    eventCount(): Promise<number>;
    clear(): Promise<void>;
}
/**
 * Persistence helpers for user ID and app version.
 */
export declare const persistence: {
    getUserId(): Promise<string | null>;
    setUserId(userId: string | null): Promise<void>;
    /**
     * Resolve the anonymous ID passed to the JS core, persisting it in Preferences
     * since webview cookies/localStorage are unreliable. An override wins (and is
     * persisted), else the stored ID is reused, else a new one is generated.
     */
    getOrCreateAnonymousId(override: string | undefined, generate: () => string): Promise<string>;
    /** Persist the anonymous ID (e.g. after rotation) so it survives app restarts. */
    setAnonymousId(anonymousId: string): Promise<void>;
    /**
     * Get the persisted opt-out choice.
     * Returns true (opted out), false (explicitly opted in), or null when the
     * user has never made an explicit choice.
     *
     * Persisted in Capacitor Preferences (native storage) so the choice
     * survives even when webview storage is cleared.
     */
    getOptOut(): Promise<boolean | null>;
    /**
     * Persist the user's explicit opt-out choice.
     * Both states are stored so an explicit optIn() overrides
     * `optedOutByDefault` on later launches.
     */
    setOptOut(optedOut: boolean): Promise<void>;
    getAppVersion(): Promise<string | null>;
    setAppVersion(version: string | null): Promise<void>;
    isFirstLaunch(): Promise<boolean>;
};
//# sourceMappingURL=storage.d.ts.map