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

  describe('store', () => {
    it('stores an event', async () => {
      const event = {
        name: 'test_event',
        client_event_id: 'test-uuid-1234',
        timestamp: '2024-01-01T00:00:00Z',
        platform: 'ios' as const,
        environment: 'test',
        user_id: 'user-123',
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
        platform: 'ios' as const,
        environment: 'test',
        user_id: 'user-123',
      };

      await smallStorage.store(newEvent);

      // Should have trimmed oldest event
      const savedData = JSON.parse(mockPreferences.set.mock.calls[0][0].value);
      expect(savedData).toHaveLength(100);
      expect(savedData[0].name).toBe('event1'); // event0 was trimmed
      expect(savedData[99].name).toBe('event_new');
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
