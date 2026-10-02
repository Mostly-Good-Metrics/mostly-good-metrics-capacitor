// Mock Capacitor Preferences before importing storage module
const mockPreferences = {
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
};

jest.mock('@capacitor/preferences', () => ({
  Preferences: mockPreferences,
}));

import { CapacitorPreferencesStorage, persistence, getStorageType } from '../storage';

describe('getStorageType', () => {
  it('returns persistent when Preferences is available', () => {
    expect(getStorageType()).toBe('persistent');
  });
});

describe('CapacitorPreferencesStorage', () => {
  let storage: CapacitorPreferencesStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences.get.mockResolvedValue({ value: null });
    mockPreferences.set.mockResolvedValue(undefined);
    mockPreferences.remove.mockResolvedValue(undefined);
    storage = new CapacitorPreferencesStorage();
  });


  describe('damaged persisted queues', () => {
    const valid = {
      name: 'valid_event', client_event_id: 'valid-id', user_id: 'test-user',
      timestamp: '2024-01-01T00:00:00Z', platform: 'ios' as const,
      environment: 'test',
    };

    it.each([{}, null, 7, 'not-an-array'])('recovers from a non-array queue: %p', async (value) => {
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(value) });
      await expect(storage.store(valid)).resolves.toBeUndefined();
      await expect(storage.fetchEvents(10)).resolves.toEqual([valid]);
    });

    it('discards damaged entries while retaining valid events and allowing removal', async () => {
      const value = [null, false, {}, { name: 'missing_timestamp' }, valid];
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(value) });
      await expect(storage.fetchEvents(10)).resolves.toEqual([valid]);
      await expect(storage.removeEvents(1, ['valid-id'])).resolves.toBeUndefined();
      await expect(storage.eventCount()).resolves.toBe(0);
    });
  });

  it.each([NaN, Infinity, -Infinity])('uses a bounded default for non-finite storage limits: %p', async (limit) => {
    const events = Array.from({ length: 3000 }, (_, i) => ({ client_event_id: `id_${i}`, name: `stored_${i}`, timestamp: '2026-01-01T00:00:00Z', user_id: 'test', platform: 'ios' as const, environment: 'test' }));
    mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(events) });
    const bounded = new CapacitorPreferencesStorage(limit);
    await bounded.store({ ...events[0]!, name: 'latest' });
    expect((bounded as unknown as { maxEvents: number }).maxEvents).toBe(10000);
    await expect(bounded.eventCount()).resolves.toBe(3001);
  });

  describe('store', () => {
    it('stores an event', async () => {
      const event = {
        name: 'test_event',
        client_event_id: 'test-uuid-1234',
        timestamp: '2024-01-01T00:00:00Z',
        user_id: 'test-user',
        platform: 'ios' as const,
        environment: 'test',
      };

      await storage.store(event);

      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'mostlygoodmetrics_events',
        value: JSON.stringify([event]),
      });
    });

    it('respects maxEvents limit', async () => {
      // Note: minimum maxEvents is 100, so we test with 100
      const smallStorage = new CapacitorPreferencesStorage(100);

      // Simulate 100 existing events
      const existingEvents = Array.from({ length: 100 }, (_, i) => ({
        name: `event${i}`,
        timestamp: '2024-01-01T00:00:00Z',
        platform: 'ios',
        environment: 'test',
      }));
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(existingEvents) });

      const newEvent = {
        name: 'event_new',
        client_event_id: 'test-uuid-new',
        timestamp: '2024-01-01T00:00:02Z',
        user_id: 'test-user',
        platform: 'ios' as const,
        environment: 'test',
      };

      await smallStorage.store(newEvent);

      // Should have trimmed oldest event
      const savedData = JSON.parse(mockPreferences.set.mock.calls[0][0].value);
      expect(savedData).toHaveLength(100);
      expect(savedData[0].name).toBe('event1'); // event0 was trimmed
      expect(savedData[99].name).toBe('event_new');
    });

    // Regression: a synchronous burst of store() calls (mirroring the wrapper
    // replaying queued events before init finishes) must not lose events to a
    // read-modify-write race. Before the fix, each concurrent store() reloaded
    // the same empty backing store and clobbered the others on write.
    it('persists every event from a synchronous burst without dropping any', async () => {
      // Backing store is empty and never reflects writes back into get() — the
      // exact condition under which the race silently drops events.
      mockPreferences.get.mockResolvedValue({ value: null });

      const burst = Array.from({ length: 10 }, (_, i) => ({
        name: `burst_event_${i}`,
        client_event_id: `burst-uuid-${i}`,
        timestamp: '2024-01-01T00:00:00Z',
        user_id: 'test-user',
        platform: 'ios' as const,
        environment: 'test',
      }));

      // Fire all stores synchronously (no await between them), then wait.
      await Promise.all(burst.map((e) => storage.store(e)));

      // All 10 must be retrievable...
      const persisted = await storage.fetchEvents(100);
      expect(persisted).toHaveLength(10);
      expect(persisted.map((e) => e.name)).toEqual(burst.map((e) => e.name));

      // ...and the final write to the backing store must contain all 10.
      const lastSet = mockPreferences.set.mock.calls.at(-1)![0];
      expect(JSON.parse(lastSet.value)).toHaveLength(10);
    });

    it('defers and coalesces a synchronous burst into one persistence write', async () => {
      const mk = (name: string) => ({
        name,
        client_event_id: name,
        timestamp: '2024-01-01T00:00:00Z',
        user_id: 'test-user',
        platform: 'ios' as const,
        environment: 'test',
      });

      const writes = [storage.store(mk('a')), storage.store(mk('b')), storage.store(mk('c'))];

      expect(mockPreferences.set).not.toHaveBeenCalled();
      await Promise.all(writes);

      expect(mockPreferences.set).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockPreferences.set.mock.calls[0][0].value)).toEqual([
        mk('a'),
        mk('b'),
        mk('c'),
      ]);
    });
  });

  describe('fetchEvents', () => {
    it('returns events up to limit', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'ios', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'ios', environment: 'test' },
        { name: 'event3', timestamp: '2024-01-01T00:00:02Z', platform: 'ios', environment: 'test' },
      ];
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(events) });

      const result = await storage.fetchEvents(2);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('event1');
      expect(result[1]!.name).toBe('event2');
    });

    it('returns empty array when no events', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: null });

      const result = await storage.fetchEvents(10);

      expect(result).toEqual([]);
    });
  });

  describe('removeEvents', () => {
    it('removes events from the beginning', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'ios', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'ios', environment: 'test' },
        { name: 'event3', timestamp: '2024-01-01T00:00:02Z', platform: 'ios', environment: 'test' },
      ];
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(events) });

      await storage.removeEvents(2);

      const savedData = JSON.parse(mockPreferences.set.mock.calls[0][0].value);
      expect(savedData).toHaveLength(1);
      expect(savedData[0].name).toBe('event3');
    });

    it('does not remove an unsent event when the sent event was trimmed at the cap', async () => {
      const cappedStorage = new CapacitorPreferencesStorage(100);
      for (let index = 0; index < 100; index += 1) {
        await cappedStorage.store({
          name: `event${index}`,
          client_event_id: `event-${index}`,
          timestamp: '2024-01-01T00:00:00Z',
          user_id: 'test-user',
          platform: 'ios',
          environment: 'test',
        });
      }
      const sentEvent = (await cappedStorage.fetchEvents(1))[0]!;

      await cappedStorage.store({
        name: 'new_event',
        client_event_id: 'new-event',
        timestamp: '2024-01-01T00:00:01Z',
        user_id: 'test-user',
        platform: 'ios',
        environment: 'test',
      });
      await cappedStorage.removeEvents(1, [sentEvent.client_event_id]);

      const remaining = await cappedStorage.fetchEvents(100);
      expect(remaining).toHaveLength(100);
      expect(remaining[0]?.client_event_id).toBe('event-1');
      expect(remaining.at(-1)?.client_event_id).toBe('new-event');
    });

    it('removes only the sent count of ID-less legacy events', async () => {
      const events = [
        { name: 'sent', timestamp: '2024-01-01T00:00:00Z', platform: 'ios', environment: 'test' },
        { name: 'unsent', timestamp: '2024-01-01T00:00:01Z', platform: 'ios', environment: 'test' },
      ];
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(events) });

      await storage.removeEvents(1, [undefined as unknown as string]);

      expect(await storage.fetchEvents(10)).toEqual([events[1]]);
    });
  });

  describe('eventCount', () => {
    it('returns count of stored events', async () => {
      const events = [
        { name: 'event1', timestamp: '2024-01-01T00:00:00Z', platform: 'ios', environment: 'test' },
        { name: 'event2', timestamp: '2024-01-01T00:00:01Z', platform: 'ios', environment: 'test' },
      ];
      mockPreferences.get.mockResolvedValueOnce({ value: JSON.stringify(events) });

      const count = await storage.eventCount();

      expect(count).toBe(2);
    });
  });

  describe('clear', () => {
    it('clears all events', async () => {
      await storage.clear();

      expect(mockPreferences.remove).toHaveBeenCalledWith({ key: 'mostlygoodmetrics_events' });
    });
  });
});

describe('persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences.get.mockResolvedValue({ value: null });
    mockPreferences.set.mockResolvedValue(undefined);
    mockPreferences.remove.mockResolvedValue(undefined);
  });

  describe('getUserId', () => {
    it('returns stored user ID', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: 'user-123' });

      const userId = await persistence.getUserId();

      expect(userId).toBe('user-123');
      expect(mockPreferences.get).toHaveBeenCalledWith({ key: 'mostlygoodmetrics_user_id' });
    });

    it('returns null when no user ID stored', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: null });

      const userId = await persistence.getUserId();

      expect(userId).toBeNull();
    });
  });

  describe('setUserId', () => {
    it('stores user ID', async () => {
      await persistence.setUserId('user-456');

      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'mostlygoodmetrics_user_id',
        value: 'user-456',
      });
    });

    it('removes user ID when null', async () => {
      await persistence.setUserId(null);

      expect(mockPreferences.remove).toHaveBeenCalledWith({ key: 'mostlygoodmetrics_user_id' });
    });
  });

  describe('getAppVersion', () => {
    it('returns stored app version', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: '1.0.0' });

      const version = await persistence.getAppVersion();

      expect(version).toBe('1.0.0');
    });
  });

  describe('setAppVersion', () => {
    it('stores app version', async () => {
      await persistence.setAppVersion('2.0.0');

      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'mostlygoodmetrics_app_version',
        value: '2.0.0',
      });
    });
  });

  describe('isFirstLaunch', () => {
    it('returns true on first launch and sets flag', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: null });

      const isFirst = await persistence.isFirstLaunch();

      expect(isFirst).toBe(true);
      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: 'mostlygoodmetrics_installed',
        value: 'true',
      });
    });

    it('returns false on subsequent launches', async () => {
      mockPreferences.get.mockResolvedValueOnce({ value: 'true' });

      const isFirst = await persistence.isFirstLaunch();

      expect(isFirst).toBe(false);
    });
  });
});

describe('failed identity persistence', () => {
  it.each([true, false])('serializes consent writes and honors the current choice while native storage is pending (latest fails: %p)', async (latestFails) => {
    let finishOld!: () => void;
    let nativeValue = 'false';
    mockPreferences.get.mockImplementation(async () => ({ value: nativeValue }));
    mockPreferences.set.mockImplementationOnce(({ value }: { value: string }) => new Promise<void>((resolve) => {
      finishOld = () => { nativeValue = value; resolve(); };
    }));
    if (latestFails) mockPreferences.set.mockRejectedValueOnce(new Error('newest write failed'));
    else mockPreferences.set.mockImplementationOnce(async ({ value }: { value: string }) => { nativeValue = value; });
    const oldWrite = persistence.setOptOut(false);
    await Promise.resolve();
    const latestWrite = persistence.setOptOut(true);
    try {
      await expect(persistence.getOptOut()).resolves.toBe(true);
      finishOld();
      await Promise.all([oldWrite, latestWrite]);
      await expect(persistence.getOptOut()).resolves.toBe(true);
      expect(nativeValue).toBe(latestFails ? 'false' : 'true');
    } finally {
      await persistence.setOptOut(false);
    }
  });

  it('retains the current identity when a native write fails but reads still return the old user', async () => {
    mockPreferences.get.mockResolvedValue({ value: 'old-user' });
    mockPreferences.set.mockRejectedValueOnce(new Error('native storage write failed'));
    try {
      await persistence.setUserId('new-user');
      await expect(persistence.getUserId()).resolves.toBe('new-user');
    } finally {
      await persistence.setUserId(null);
    }
  });

  it('does not restore the logged-out user when native removal fails', async () => {
    mockPreferences.get.mockResolvedValue({ value: 'old-user' });
    mockPreferences.remove.mockRejectedValueOnce(new Error('native storage removal failed'));
    try {
      await persistence.setUserId(null);
      await expect(persistence.getUserId()).resolves.toBeNull();
    } finally {
      await persistence.setUserId(null);
    }
  });
});
