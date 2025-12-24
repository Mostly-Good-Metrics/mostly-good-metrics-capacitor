const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';
// Try to import Capacitor Preferences, fall back to null if not available
let Preferences = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Preferences = require('@capacitor/preferences').Preferences;
}
catch {
    // Preferences plugin not installed - will use in-memory storage
}
/**
 * Returns the storage type being used.
 */
export function getStorageType() {
    return Preferences ? 'persistent' : 'memory';
}
/**
 * In-memory fallback storage when Preferences is not available.
 */
const memoryStorage = {};
/**
 * Storage helpers that work with or without Capacitor Preferences.
 */
async function getItem(key) {
    if (Preferences) {
        try {
            const result = await Preferences.get({ key });
            return result.value;
        }
        catch {
            return memoryStorage[key] ?? null;
        }
    }
    return memoryStorage[key] ?? null;
}
async function setItem(key, value) {
    memoryStorage[key] = value;
    if (Preferences) {
        try {
            await Preferences.set({ key, value });
        }
        catch {
            // Fall back to memory storage (already set above)
        }
    }
}
async function removeItem(key) {
    delete memoryStorage[key];
    if (Preferences) {
        try {
            await Preferences.remove({ key });
        }
        catch {
            // Already removed from memory
        }
    }
}
/**
 * Event storage for Capacitor.
 * Uses Capacitor Preferences if available, otherwise falls back to in-memory storage.
 */
export class CapacitorPreferencesStorage {
    maxEvents;
    events = null;
    constructor(maxEvents = 10000) {
        this.maxEvents = Math.max(maxEvents, 100);
    }
    async loadEvents() {
        if (this.events !== null) {
            return this.events;
        }
        try {
            const stored = await getItem(STORAGE_KEY);
            if (stored) {
                this.events = JSON.parse(stored);
            }
            else {
                this.events = [];
            }
        }
        catch {
            this.events = [];
        }
        return this.events;
    }
    async saveEvents() {
        await setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
    }
    async store(event) {
        const events = await this.loadEvents();
        events.push(event);
        // Trim oldest events if we exceed the limit
        if (events.length > this.maxEvents) {
            const excess = events.length - this.maxEvents;
            events.splice(0, excess);
        }
        await this.saveEvents();
    }
    async fetchEvents(limit) {
        const events = await this.loadEvents();
        return events.slice(0, limit);
    }
    async removeEvents(count) {
        const events = await this.loadEvents();
        events.splice(0, count);
        await this.saveEvents();
    }
    async eventCount() {
        const events = await this.loadEvents();
        return events.length;
    }
    async clear() {
        this.events = [];
        await removeItem(STORAGE_KEY);
    }
}
/**
 * Persistence helpers for user ID and app version.
 */
export const persistence = {
    async getUserId() {
        return getItem(USER_ID_KEY);
    },
    async setUserId(userId) {
        if (userId) {
            await setItem(USER_ID_KEY, userId);
        }
        else {
            await removeItem(USER_ID_KEY);
        }
    },
    async getAppVersion() {
        return getItem(APP_VERSION_KEY);
    },
    async setAppVersion(version) {
        if (version) {
            await setItem(APP_VERSION_KEY, version);
        }
        else {
            await removeItem(APP_VERSION_KEY);
        }
    },
    async isFirstLaunch() {
        const hasLaunched = await getItem(FIRST_LAUNCH_KEY);
        if (!hasLaunched) {
            await setItem(FIRST_LAUNCH_KEY, 'true');
            return true;
        }
        return false;
    },
};
