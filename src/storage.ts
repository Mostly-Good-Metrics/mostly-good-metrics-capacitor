import type { IEventStorage, MGMEvent } from '@mostly-good-metrics/javascript';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';
const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';

// Try to import Capacitor Preferences, fall back to null if not available
let Preferences: typeof import('@capacitor/preferences').Preferences | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Preferences = require('@capacitor/preferences').Preferences;
} catch {
  // Preferences plugin not installed - will use in-memory storage
}

/**
 * Returns the storage type being used.
 */
export function getStorageType(): 'persistent' | 'memory' {
  return Preferences ? 'persistent' : 'memory';
}

/**
 * In-memory fallback storage when Preferences is not available.
 */
const memoryStorage: Record<string, string> = {};

/**
 * Storage helpers that work with or without Capacitor Preferences.
 */
async function getItem(key: string): Promise<string | null> {
  if (Preferences) {
    try {
      const result = await Preferences.get({ key });
      return result.value;
    } catch {
      return memoryStorage[key] ?? null;
    }
  }
  return memoryStorage[key] ?? null;
}

async function setItem(key: string, value: string): Promise<void> {
  memoryStorage[key] = value;
  if (Preferences) {
    try {
      await Preferences.set({ key, value });
    } catch {
      // Fall back to memory storage (already set above)
    }
  }
}

async function removeItem(key: string): Promise<void> {
  delete memoryStorage[key];
  if (Preferences) {
    try {
      await Preferences.remove({ key });
    } catch {
      // Already removed from memory
    }
  }
}

/**
 * Event storage for Capacitor.
 * Uses Capacitor Preferences if available, otherwise falls back to in-memory storage.
 */
export class CapacitorPreferencesStorage implements IEventStorage {
  private maxEvents: number;
  private events: MGMEvent[] | null = null;
  // Serializes every storage operation so concurrent/rapid calls can't
  // read-modify-write over each other. Without this, a synchronous burst of
  // store() calls (e.g. the wrapper replaying queued events before init
  // finishes) each read the same stale backing store and then clobber each
  // other on write, silently dropping events.
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(maxEvents: number = 10000) {
    this.maxEvents = Math.max(maxEvents, 100);
  }

  /**
   * Run an operation after all previously enqueued operations complete, so the
   * read-modify-write sequence inside each op is atomic with respect to the
   * others. A failed op does not wedge the queue.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.opChain.then(op, op);
    this.opChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async loadEvents(): Promise<MGMEvent[]> {
    if (this.events !== null) {
      return this.events;
    }

    try {
      const stored = await getItem(STORAGE_KEY);
      if (stored) {
        this.events = JSON.parse(stored) as MGMEvent[];
      } else {
        this.events = [];
      }
    } catch {
      this.events = [];
    }

    return this.events;
  }

  private async saveEvents(): Promise<void> {
    await setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
  }

  async store(event: MGMEvent): Promise<void> {
    return this.enqueue(async () => {
      const events = await this.loadEvents();
      events.push(event);

      // Trim oldest events if we exceed the limit
      if (events.length > this.maxEvents) {
        const excess = events.length - this.maxEvents;
        events.splice(0, excess);
      }

      await this.saveEvents();
    });
  }

  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    return this.enqueue(async () => {
      const events = await this.loadEvents();
      return events.slice(0, limit);
    });
  }

  async removeEvents(count: number): Promise<void> {
    return this.enqueue(async () => {
      const events = await this.loadEvents();
      events.splice(0, count);
      await this.saveEvents();
    });
  }

  async eventCount(): Promise<number> {
    return this.enqueue(async () => {
      const events = await this.loadEvents();
      return events.length;
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.events = [];
      await removeItem(STORAGE_KEY);
    });
  }
}

/**
 * Persistence helpers for user ID and app version.
 */
export const persistence = {
  async getUserId(): Promise<string | null> {
    return getItem(USER_ID_KEY);
  },

  async setUserId(userId: string | null): Promise<void> {
    if (userId) {
      await setItem(USER_ID_KEY, userId);
    } else {
      await removeItem(USER_ID_KEY);
    }
  },

  /**
   * Resolve the anonymous ID passed to the JS core, persisting it in Preferences
   * since webview cookies/localStorage are unreliable. An override wins (and is
   * persisted), else the stored ID is reused, else a new one is generated.
   */
  async getOrCreateAnonymousId(
    override: string | undefined,
    generate: () => string
  ): Promise<string> {
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
  async setAnonymousId(anonymousId: string): Promise<void> {
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
  async getOptOut(): Promise<boolean | null> {
    const stored = await getItem(OPT_OUT_KEY);
    if (stored === 'true') {
      return true;
    }
    if (stored === 'false') {
      return false;
    }
    return null;
  },

  /**
   * Persist the user's explicit opt-out choice.
   * Both states are stored so an explicit optIn() overrides
   * `optedOutByDefault` on later launches.
   */
  async setOptOut(optedOut: boolean): Promise<void> {
    await setItem(OPT_OUT_KEY, optedOut ? 'true' : 'false');
  },

  async getAppVersion(): Promise<string | null> {
    return getItem(APP_VERSION_KEY);
  },

  async setAppVersion(version: string | null): Promise<void> {
    if (version) {
      await setItem(APP_VERSION_KEY, version);
    } else {
      await removeItem(APP_VERSION_KEY);
    }
  },

  async isFirstLaunch(): Promise<boolean> {
    const hasLaunched = await getItem(FIRST_LAUNCH_KEY);
    if (!hasLaunched) {
      await setItem(FIRST_LAUNCH_KEY, 'true');
      return true;
    }
    return false;
  },
};
