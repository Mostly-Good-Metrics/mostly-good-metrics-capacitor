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
    constructor(maxEvents?: number);
    private loadEvents;
    private saveEvents;
    store(event: MGMEvent): Promise<void>;
    fetchEvents(limit: number): Promise<MGMEvent[]>;
    removeEvents(count: number): Promise<void>;
    eventCount(): Promise<number>;
    clear(): Promise<void>;
}
/**
 * Persistence helpers for user ID and app version.
 */
export declare const persistence: {
    getUserId(): Promise<string | null>;
    setUserId(userId: string | null): Promise<void>;
    getAppVersion(): Promise<string | null>;
    setAppVersion(version: string | null): Promise<void>;
    isFirstLaunch(): Promise<boolean>;
};
//# sourceMappingURL=storage.d.ts.map