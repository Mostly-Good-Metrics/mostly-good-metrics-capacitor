import { MAX_RETAINED_BYTES, ownedSnapshot } from './retention';
import { NativeTimeoutError, withNativeDeadline } from './native';
// Internal wrapper lifecycle hook; not exported from the package entrypoint.
const invalidatedStores = new WeakSet();
const invalidateCallbacks = new WeakMap();
export function invalidateEventStorage(storage) {
    invalidatedStores.add(storage);
    invalidateCallbacks.get(storage)?.();
}
const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';
const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';
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
// A failed native write must not resurrect stale durable identity or consent.
const failedWrites = new Set();
const writeQueues = new Map();
const writeRevisions = new Map();
const quarantinedKeys = new Set();
const nativeReads = new Map();
const quarantinedReads = new Set();
function memoryValue(key) {
    // If native consent cannot be read, stay opted out until an explicit choice.
    return memoryStorage[key] ?? (key === OPT_OUT_KEY ? 'true' : null);
}
function enqueueWrite(key, mutation) {
    if (quarantinedKeys.has(key))
        return Promise.resolve();
    const existing = writeQueues.get(key);
    if (existing) {
        existing.latest = mutation;
        return existing.promise;
    }
    const pending = { latest: mutation, promise: Promise.resolve() };
    writeQueues.set(key, pending);
    pending.promise = Promise.resolve().then(async () => {
        try {
            while (pending.latest && !quarantinedKeys.has(key)) {
                const mutation = pending.latest;
                pending.latest = null;
                try {
                    await withNativeDeadline(() => mutation.value === null ? Preferences.remove({ key }) : Preferences.set({ key, value: mutation.value }));
                    failedWrites.delete(key);
                }
                catch (error) {
                    failedWrites.add(key);
                    if (error instanceof NativeTimeoutError) {
                        // The native call may still finish later. Never issue a newer call
                        // that it could overwrite; use process-memory state from now on.
                        quarantinedKeys.add(key);
                        pending.latest = null;
                    }
                }
            }
        }
        finally {
            writeQueues.delete(key);
        }
    });
    return pending.promise;
}
async function getItem(key) {
    if (failedWrites.has(key) || writeQueues.has(key) || quarantinedKeys.has(key) || quarantinedReads.has(key))
        return memoryValue(key);
    if (Preferences) {
        const revision = writeRevisions.get(key) ?? 0;
        try {
            let reading = nativeReads.get(key);
            if (!reading) {
                reading = withNativeDeadline(() => Preferences.get({ key }).then((result) => result.value)).catch((error) => {
                    if (error instanceof NativeTimeoutError)
                        quarantinedReads.add(key);
                    throw error;
                }).finally(() => nativeReads.delete(key));
                nativeReads.set(key, reading);
            }
            const value = await reading;
            return revision === (writeRevisions.get(key) ?? 0) ? value : memoryValue(key);
        }
        catch {
            return memoryValue(key);
        }
    }
    return memoryStorage[key] ?? null;
}
async function setItem(key, value) {
    memoryStorage[key] = value;
    writeRevisions.set(key, (writeRevisions.get(key) ?? 0) + 1);
    if (Preferences)
        await enqueueWrite(key, { value });
}
async function removeItem(key) {
    delete memoryStorage[key];
    writeRevisions.set(key, (writeRevisions.get(key) ?? 0) + 1);
    if (Preferences)
        await enqueueWrite(key, { value: null });
}
/**
 * Event storage for Capacitor.
 * Uses Capacitor Preferences if available, otherwise falls back to in-memory storage.
 */
export class CapacitorPreferencesStorage {
    maxEvents;
    events = null;
    // Serializes every storage operation so concurrent/rapid calls can't
    // read-modify-write over each other. Without this, a synchronous burst of
    // store() calls (e.g. the wrapper replaying queued events before init
    // finishes) each read the same stale backing store and then clobber each
    // other on write, silently dropping events.
    opChain = Promise.resolve();
    storeGeneration = 0;
    retainedBytes = 0;
    pendingStoreBytes = 0;
    countRead = null;
    clearOperation = null;
    fetchReads = new Map();
    pendingSave = null;
    resolvePendingSave = null;
    rejectPendingSave = null;
    saveTimer = null;
    constructor(maxEvents = 10000) {
        invalidateCallbacks.set(this, () => {
            this.storeGeneration += 1;
            this.cancelPendingSave();
            this.events = [];
            this.retainedBytes = 0;
        });
        this.maxEvents = Math.min(Math.max(Number.isFinite(maxEvents) ? Math.floor(maxEvents) : 10000, 100), Number.MAX_SAFE_INTEGER);
    }
    /**
     * Run an operation after all previously enqueued operations complete, so the
     * read-modify-write sequence inside each op is atomic with respect to the
     * others. A failed op does not wedge the queue.
     */
    enqueue(op) {
        const result = this.opChain.then(op, op);
        this.opChain = result.then(() => undefined, () => undefined);
        return result;
    }
    async loadEvents() {
        if (invalidatedStores.has(this))
            return [];
        if (this.events !== null) {
            return this.events;
        }
        try {
            const stored = await getItem(STORAGE_KEY);
            if (invalidatedStores.has(this))
                return [];
            this.events = [];
            if (stored && stored.length * 2 <= MAX_RETAINED_BYTES) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    for (const event of parsed) {
                        if (!event || typeof event !== 'object' || typeof event.name !== 'string' || typeof event.timestamp !== 'string')
                            continue;
                        const snapshot = ownedSnapshot(event);
                        if (!snapshot)
                            continue;
                        this.events.push(snapshot.value);
                        this.retainedBytes += snapshot.bytes;
                        this.trimEvents();
                    }
                }
            }
        }
        catch {
            this.events = [];
        }
        return this.events;
    }
    trimEvents() {
        while (this.events && (this.events.length > this.maxEvents || this.retainedBytes + this.pendingStoreBytes > MAX_RETAINED_BYTES)) {
            const removed = this.events.shift();
            if (removed)
                this.retainedBytes -= ownedSnapshot(removed)?.bytes ?? 0;
        }
    }
    async saveEvents() {
        if (invalidatedStores.has(this))
            return;
        await setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
    }
    scheduleSave() {
        if (this.pendingSave) {
            return this.pendingSave;
        }
        this.pendingSave = new Promise((resolve, reject) => {
            this.resolvePendingSave = resolve;
            this.rejectPendingSave = reject;
        });
        this.saveTimer = setTimeout(() => this.startPendingSave(), 0);
        return this.pendingSave;
    }
    startPendingSave() {
        if (!this.pendingSave)
            return;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        void this.enqueue(async () => {
            const resolve = this.resolvePendingSave;
            const reject = this.rejectPendingSave;
            try {
                await this.saveEvents();
                resolve?.();
            }
            catch (error) {
                reject?.(error);
            }
            finally {
                this.pendingSave = null;
                this.resolvePendingSave = null;
                this.rejectPendingSave = null;
            }
        });
    }
    cancelPendingSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.resolvePendingSave?.();
        this.pendingSave = null;
        this.resolvePendingSave = null;
        this.rejectPendingSave = null;
    }
    store(event) {
        if (invalidatedStores.has(this))
            return Promise.resolve();
        const snapshot = ownedSnapshot(event);
        if (!snapshot || this.retainedBytes + this.pendingStoreBytes + snapshot.bytes > MAX_RETAINED_BYTES)
            return Promise.resolve();
        this.pendingStoreBytes += snapshot.bytes;
        const generation = this.storeGeneration;
        let released = false;
        let save = Promise.resolve();
        const mutation = this.enqueue(async () => {
            try {
                const events = await this.loadEvents();
                if (generation !== this.storeGeneration)
                    return;
                this.pendingStoreBytes -= snapshot.bytes;
                released = true;
                events.push(snapshot.value);
                this.retainedBytes += snapshot.bytes;
                this.trimEvents();
                save = this.scheduleSave();
            }
            finally {
                if (!released)
                    this.pendingStoreBytes -= snapshot.bytes;
            }
        });
        return mutation.then(() => save);
    }
    fetchEvents(limit) {
        const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(Math.floor(limit), this.maxEvents)) : this.maxEvents;
        const pending = this.fetchReads.get(boundedLimit);
        if (pending)
            return pending;
        // Bound simultaneous distinct fetch requests while native hydration stalls.
        if (this.fetchReads.size >= 16)
            return Promise.resolve([]);
        const reading = this.enqueue(async () => {
            const events = await this.loadEvents();
            return events.slice(0, boundedLimit).map((event) => ownedSnapshot(event).value);
        });
        this.fetchReads.set(boundedLimit, reading);
        void reading.then(() => this.fetchReads.delete(boundedLimit), () => this.fetchReads.delete(boundedLimit));
        return reading;
    }
    removeEvents(count, clientEventIds) {
        if (invalidatedStores.has(this))
            return Promise.resolve();
        let save = Promise.resolve();
        const mutation = this.enqueue(async () => {
            const events = await this.loadEvents();
            if (invalidatedStores.has(this))
                return;
            if (clientEventIds?.length) {
                const sentIds = new Set(clientEventIds.filter(Boolean));
                let idlessEventsToRemove = Math.max(0, count - sentIds.size);
                this.events = events.filter((event) => {
                    if (event.client_event_id) {
                        return !sentIds.has(event.client_event_id);
                    }
                    if (idlessEventsToRemove > 0) {
                        idlessEventsToRemove -= 1;
                        return false;
                    }
                    return true;
                });
            }
            else {
                events.splice(0, count);
            }
            this.retainedBytes = (this.events ?? []).reduce((bytes, event) => bytes + (ownedSnapshot(event)?.bytes ?? 0), 0);
            save = this.scheduleSave();
        });
        return mutation.then(() => save);
    }
    eventCount() {
        if (this.countRead)
            return this.countRead;
        const reading = this.enqueue(async () => (await this.loadEvents()).length);
        this.countRead = reading;
        void reading.then(() => { this.countRead = null; }, () => { this.countRead = null; });
        return reading;
    }
    clear() {
        if (invalidatedStores.has(this))
            return Promise.resolve();
        // Every privacy clear invalidates earlier admitted stores, including calls
        // queued between two coalesced clears while native hydration is pending.
        this.storeGeneration += 1;
        if (this.clearOperation)
            return this.clearOperation;
        const clearing = this.enqueue(async () => {
            if (invalidatedStores.has(this))
                return;
            this.cancelPendingSave();
            this.events = [];
            this.retainedBytes = 0;
            await removeItem(STORAGE_KEY);
        });
        this.clearOperation = clearing;
        void clearing.then(() => { this.clearOperation = null; }, () => { this.clearOperation = null; });
        return clearing;
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
    /**
     * Resolve the anonymous ID passed to the JS core, persisting it in Preferences
     * since webview cookies/localStorage are unreliable. An override wins (and is
     * persisted), else the stored ID is reused, else a new one is generated.
     */
    async getOrCreateAnonymousId(override, generate) {
        if (override) {
            await setItem(ANONYMOUS_ID_KEY, override);
            return override;
        }
        const existing = await getItem(ANONYMOUS_ID_KEY);
        if (existing) {
            return existing;
        }
        const newId = generate();
        await setItem(ANONYMOUS_ID_KEY, newId);
        return newId;
    },
    /** Persist the anonymous ID (e.g. after rotation) so it survives app restarts. */
    async setAnonymousId(anonymousId) {
        await setItem(ANONYMOUS_ID_KEY, anonymousId);
    },
    /**
     * Get the persisted opt-out choice.
     * Returns true (opted out), false (explicitly opted in), or null when the
     * user has never made an explicit choice.
     *
     * Persisted in Capacitor Preferences (native storage) so the choice
     * survives even when webview storage is cleared.
     */
    async getOptOut() {
        const stored = await getItem(OPT_OUT_KEY);
        if (stored === 'true') {
            return true;
        }
        if (stored === 'false') {
            return false;
        }
        // A missing value is a new installation; malformed persisted consent is
        // not permission to collect analytics. Explicit optIn can replace it.
        return stored === null ? null : true;
    },
    /**
     * Persist the user's explicit opt-out choice.
     * Both states are stored so an explicit optIn() overrides
     * `optedOutByDefault` on later launches.
     */
    async setOptOut(optedOut) {
        await setItem(OPT_OUT_KEY, optedOut ? 'true' : 'false');
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
