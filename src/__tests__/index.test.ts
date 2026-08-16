// Mock Capacitor core before importing
jest.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: jest.fn(() => 'ios'),
  },
}));

// Mock Capacitor plugins
jest.mock('@capacitor/app', () => ({
  App: {
    addListener: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  },
}));

jest.mock('@capacitor/device', () => ({
  Device: {
    getInfo: jest.fn().mockResolvedValue({
      model: 'iPhone 14',
      osVersion: '17.0',
      manufacturer: 'Apple',
    }),
  },
}));

jest.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: jest.fn().mockResolvedValue({ value: null }),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock the JS SDK to capture configuration
const mockConfigure = jest.fn();
const mockTrack = jest.fn();
const mockSetSuperProperty = jest.fn();
const mockSetSuperProperties = jest.fn();
const mockRemoveSuperProperty = jest.fn();
const mockClearSuperProperties = jest.fn();
const mockGetSuperProperties = jest.fn().mockReturnValue({});
const mockIsConfigured = false;
const mockCoreOptOut = jest.fn();
const mockCoreOptIn = jest.fn();
const mockCoreIsOptedOut = jest.fn().mockReturnValue(false);
const mockCoreResetAnonymousId = jest.fn().mockReturnValue('$anon_rotated1234');
const mockGetVariant = jest.fn().mockReturnValue(null);
const mockReady = jest.fn().mockResolvedValue(undefined);
const mockGenerateAnonymousId = jest.fn(() => '$anon_mockmockmock');

jest.mock('@mostly-good-metrics/javascript', () => ({
  MostlyGoodMetrics: {
    configure: mockConfigure,
    track: mockTrack,
    isConfigured: mockIsConfigured,
    shared: null,
    flush: jest.fn().mockResolvedValue(undefined),
    identify: jest.fn(),
    resetIdentity: jest.fn(),
    startNewSession: jest.fn(),
    clearPendingEvents: jest.fn().mockResolvedValue(undefined),
    getPendingEventCount: jest.fn().mockResolvedValue(0),
    reset: jest.fn(),
    optOut: mockCoreOptOut,
    optIn: mockCoreOptIn,
    isOptedOut: mockCoreIsOptedOut,
    resetAnonymousId: mockCoreResetAnonymousId,
    setSuperProperty: mockSetSuperProperty,
    setSuperProperties: mockSetSuperProperties,
    removeSuperProperty: mockRemoveSuperProperty,
    clearSuperProperties: mockClearSuperProperties,
    getSuperProperties: mockGetSuperProperties,
    getVariant: mockGetVariant,
    ready: mockReady,
  },
  generateAnonymousId: mockGenerateAnonymousId,
  SystemEvents: {
    APP_INSTALLED: '$app_installed',
    APP_UPDATED: '$app_updated',
    APP_OPENED: '$app_opened',
    APP_BACKGROUNDED: '$app_backgrounded',
  },
  SystemProperties: {
    DEVICE_TYPE: '$device_type',
    DEVICE_MODEL: '$device_model',
    VERSION: '$version',
    PREVIOUS_VERSION: '$previous_version',
    SDK: '$sdk',
  },
}));

// Import after mocks are set up
import MostlyGoodMetrics from '../index';
import { Capacitor } from '@capacitor/core';

// configure() resolves the persisted opt-out choice from Capacitor
// Preferences before constructing the JS client, so tests must let that
// async init settle before asserting on the JS client mocks.
const flushInit = () => new Promise((resolve) => setImmediate(resolve));

describe('MostlyGoodMetrics Capacitor SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset platform mock
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');
    // Reset the SDK state
    MostlyGoodMetrics.destroy();
  });

  describe('configure', () => {
    it('should pass platform as ios when Capacitor platform is ios', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('ios');
    });

    it('should pass platform as android when Capacitor platform is android', async () => {
      (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');

      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('android');
    });

    it('should pass platform as web when Capacitor platform is web', async () => {
      (Capacitor.getPlatform as jest.Mock).mockReturnValue('web');

      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('web');
    });

    it('should pass sdk as capacitor', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.sdk).toBe('capacitor');
    });

    it('should disable JS SDK lifecycle tracking', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.trackAppLifecycleEvents).toBe(false);
    });

    it('should pass through custom config options', async () => {
      MostlyGoodMetrics.configure('test-api-key', {
        environment: 'staging',
        maxBatchSize: 50,
        flushInterval: 15,
      });
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.environment).toBe('staging');
      expect(configArg.maxBatchSize).toBe(50);
      expect(configArg.flushInterval).toBe(15);
    });

    it('should not configure twice', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      MostlyGoodMetrics.configure('test-api-key-2');
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
    });
  });

  // MGM-195: assert the wrapper persists a stable anonymous ID and feeds it to
  // the core via the `anonymousId` override (the core stamps it onto $identify).
  describe('anonymous ID (MGM-195)', () => {
    const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
    const mockPreferences = jest.requireMock('@capacitor/preferences').Preferences;
    const mockIdentify = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics
      .identify;

    afterEach(() => {
      mockPreferences.get.mockResolvedValue({ value: null });
    });

    it('should generate, persist and pass a stable anonymous ID when none is stored', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockGenerateAnonymousId).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('$anon_mockmockmock');
      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: ANONYMOUS_ID_KEY,
        value: '$anon_mockmockmock',
      });
    });

    it('should reuse the persisted anonymous ID on subsequent launches', async () => {
      mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
        Promise.resolve({ value: key === ANONYMOUS_ID_KEY ? '$anon_persisted12' : null })
      );

      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      expect(mockGenerateAnonymousId).not.toHaveBeenCalled();
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('$anon_persisted12');
    });

    it('should honor and persist an explicit anonymousId override', async () => {
      mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
        Promise.resolve({ value: key === ANONYMOUS_ID_KEY ? '$anon_persisted12' : null })
      );

      MostlyGoodMetrics.configure('test-api-key', { anonymousId: 'device-abc' });
      await flushInit();

      expect(mockGenerateAnonymousId).not.toHaveBeenCalled();
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('device-abc');
      expect(mockPreferences.set).toHaveBeenCalledWith({
        key: ANONYMOUS_ID_KEY,
        value: 'device-abc',
      });
    });

    it('should wire the persisted anonymous ID into the core so identify() emits $anonymous_id', async () => {
      // Assert the wrapper feeds the persisted ID to the core and forwards identify().
      mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
        Promise.resolve({ value: key === ANONYMOUS_ID_KEY ? '$anon_beforeid99' : null })
      );

      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.anonymousId).toBe('$anon_beforeid99');

      MostlyGoodMetrics.identify('user_123', { email: 'user@example.com' });

      // The core emits $identify carrying $anonymous_id = '$anon_beforeid99'.
      expect(mockIdentify).toHaveBeenCalledWith('user_123', { email: 'user@example.com' });
    });
  });

  describe('track', () => {
    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      // Let the async opt-out restore + deferred $app_opened settle
      await new Promise((resolve) => setImmediate(resolve));
      jest.clearAllMocks();
    });

    it('should add device type to properties', () => {
      MostlyGoodMetrics.track('test_event');

      expect(mockTrack).toHaveBeenCalledTimes(1);
      const [eventName, props] = mockTrack.mock.calls[0];
      expect(eventName).toBe('test_event');
      expect(props['$device_type']).toBe('phone');
    });

    it('should add storage type to properties', () => {
      MostlyGoodMetrics.track('test_event');

      expect(mockTrack).toHaveBeenCalledTimes(1);
      const [, props] = mockTrack.mock.calls[0];
      expect(props['$storage_type']).toBe('persistent');
    });

    it('should merge custom properties', () => {
      MostlyGoodMetrics.track('test_event', { custom_prop: 'value' });

      expect(mockTrack).toHaveBeenCalledTimes(1);
      const [, props] = mockTrack.mock.calls[0];
      expect(props['custom_prop']).toBe('value');
    });

    it('should not track when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      MostlyGoodMetrics.track('test_event');

      expect(mockTrack).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[MostlyGoodMetrics] SDK not configured. Call configure() first.'
      );
      warnSpy.mockRestore();
    });
  });

  describe('super properties', () => {
    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('should call setSuperProperty on the JS SDK', () => {
      MostlyGoodMetrics.setSuperProperty('plan', 'premium');

      expect(mockSetSuperProperty).toHaveBeenCalledTimes(1);
      expect(mockSetSuperProperty).toHaveBeenCalledWith('plan', 'premium');
    });

    it('should call setSuperProperties on the JS SDK', () => {
      const props = { plan: 'premium', tier: 'gold' };
      MostlyGoodMetrics.setSuperProperties(props);

      expect(mockSetSuperProperties).toHaveBeenCalledTimes(1);
      expect(mockSetSuperProperties).toHaveBeenCalledWith(props);
    });

    it('should call removeSuperProperty on the JS SDK', () => {
      MostlyGoodMetrics.removeSuperProperty('plan');

      expect(mockRemoveSuperProperty).toHaveBeenCalledTimes(1);
      expect(mockRemoveSuperProperty).toHaveBeenCalledWith('plan');
    });

    it('should call clearSuperProperties on the JS SDK', () => {
      MostlyGoodMetrics.clearSuperProperties();

      expect(mockClearSuperProperties).toHaveBeenCalledTimes(1);
    });

    it('should call getSuperProperties on the JS SDK', () => {
      mockGetSuperProperties.mockReturnValue({ plan: 'premium' });

      const result = MostlyGoodMetrics.getSuperProperties();

      expect(mockGetSuperProperties).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ plan: 'premium' });
    });

    it('should not call setSuperProperty when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      MostlyGoodMetrics.setSuperProperty('plan', 'premium');

      expect(mockSetSuperProperty).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('destroy', () => {
    it('should reset configuration state', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();

      MostlyGoodMetrics.destroy();
      MostlyGoodMetrics.configure('test-api-key-2');
      await flushInit();

      // Should be able to configure again after destroy
      expect(mockConfigure).toHaveBeenCalledTimes(1);
    });
  });

  describe('identify', () => {
    const mockIdentify = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics.identify;

    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('should call identify with just userId', () => {
      MostlyGoodMetrics.identify('user_123');

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user_123', undefined);
    });

    it('should call identify with userId and profile', () => {
      const profile = { email: 'user@example.com', name: 'Jane Doe' };
      MostlyGoodMetrics.identify('user_123', profile);

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user_123', profile);
    });

    it('should call identify with userId and partial profile (email only)', () => {
      const profile = { email: 'user@example.com' };
      MostlyGoodMetrics.identify('user_123', profile);

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user_123', profile);
    });

    it('should call identify with userId and partial profile (name only)', () => {
      const profile = { name: 'Jane Doe' };
      MostlyGoodMetrics.identify('user_123', profile);

      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith('user_123', profile);
    });

    it('should not call identify when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      MostlyGoodMetrics.identify('user_123', { email: 'user@example.com' });

      expect(mockIdentify).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[MostlyGoodMetrics] SDK not configured. Call configure() first.'
      );
      warnSpy.mockRestore();
    });
  });

  describe('privacy controls', () => {
    const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';
    const mockCore = jest.requireMock('@mostly-good-metrics/javascript').MostlyGoodMetrics;
    const mockPreferences = jest.requireMock('@capacitor/preferences').Preferences;

    // Lets async work (Preferences reads, deferred lifecycle events) settle
    const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

    afterEach(() => {
      mockPreferences.get.mockResolvedValue({ value: null });
    });

    describe('optOut / optIn', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushAsync();
        jest.clearAllMocks();
      });

      it('should not be opted out by default', () => {
        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
      });

      it('should persist the opt-out in Preferences and forward it to the JS SDK', () => {
        MostlyGoodMetrics.optOut();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        expect(mockPreferences.set).toHaveBeenCalledWith({ key: OPT_OUT_KEY, value: 'true' });
        expect(mockCoreOptOut).toHaveBeenCalledTimes(1);
      });

      it('should stop track/identify/flush after optOut', () => {
        MostlyGoodMetrics.optOut();

        MostlyGoodMetrics.track('ignored_event');
        MostlyGoodMetrics.identify('user-123');
        MostlyGoodMetrics.flush();

        expect(mockTrack).not.toHaveBeenCalled();
        expect(mockCore.identify).not.toHaveBeenCalled();
        expect(mockCore.flush).not.toHaveBeenCalled();
      });

      it('should resume tracking after optIn', () => {
        MostlyGoodMetrics.optOut();
        MostlyGoodMetrics.optIn();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
        expect(mockPreferences.set).toHaveBeenCalledWith({ key: OPT_OUT_KEY, value: 'false' });
        expect(mockCoreOptIn).toHaveBeenCalledTimes(1);

        MostlyGoodMetrics.track('tracked_event');
        expect(mockTrack).toHaveBeenCalledTimes(1);
        expect(mockTrack.mock.calls[0][0]).toBe('tracked_event');
      });

      it('should return false from isOptedOut when SDK is not configured', () => {
        MostlyGoodMetrics.destroy();
        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
      });
    });

    describe('opt-out persistence across launches', () => {
      it('should restore a persisted opt-out on configure', async () => {
        mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
          Promise.resolve({ value: key === OPT_OUT_KEY ? 'true' : null })
        );

        MostlyGoodMetrics.configure('test-api-key');
        await flushAsync();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        // The JS client is constructed already opted out - the persisted
        // choice is resolved BEFORE construction, so its experiments
        // initialization (including local-mode config fetches) is gated
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(true);
        // Initial lifecycle $app_opened is suppressed too
        expect(mockTrack).not.toHaveBeenCalled();
      });

      it('should start opted out with optedOutByDefault', async () => {
        MostlyGoodMetrics.configure('test-api-key', { optedOutByDefault: true });

        expect(MostlyGoodMetrics.isOptedOut()).toBe(true);
        MostlyGoodMetrics.track('consent_first');
        await flushAsync();

        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(true);
        expect(mockTrack).not.toHaveBeenCalled();
      });

      it('should resolve the persisted opt-out before local-experiments init', async () => {
        mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
          Promise.resolve({ value: key === OPT_OUT_KEY ? 'true' : null })
        );

        MostlyGoodMetrics.configure('test-api-key', { experimentMode: 'local' });
        await flushAsync();

        // The JS client is constructed AFTER the Preferences read resolves,
        // already opted out - so its local-mode config fetch is gated from
        // the very start (zero network while opted out)
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.experimentMode).toBe('local');
        expect(configArg.optedOutByDefault).toBe(true);
      });

      it('should let a persisted opt-in override optedOutByDefault', async () => {
        mockPreferences.get.mockImplementation(({ key }: { key: string }) =>
          Promise.resolve({ value: key === OPT_OUT_KEY ? 'false' : null })
        );

        MostlyGoodMetrics.configure('test-api-key', { optedOutByDefault: true });
        await flushAsync();

        expect(MostlyGoodMetrics.isOptedOut()).toBe(false);
        // The JS client is constructed opted in
        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.optedOutByDefault).toBe(false);
      });
    });

    describe('resetAnonymousId', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushAsync();
        jest.clearAllMocks();
      });

      it('should rotate the anonymous ID via the JS SDK', () => {
        const newId = MostlyGoodMetrics.resetAnonymousId();

        expect(mockCoreResetAnonymousId).toHaveBeenCalledTimes(1);
        expect(newId).toBe('$anon_rotated1234');
      });

      it('should clear sticky local experiment assignments on rotation', () => {
        const removeItem = jest.fn();
        (globalThis as { localStorage?: unknown }).localStorage = { removeItem };

        try {
          MostlyGoodMetrics.resetAnonymousId();

          expect(removeItem).toHaveBeenCalledWith('mgm_local_experiment_assignments');
        } finally {
          delete (globalThis as { localStorage?: unknown }).localStorage;
        }
      });

      it('should return null when SDK is not configured', () => {
        MostlyGoodMetrics.destroy();

        const newId = MostlyGoodMetrics.resetAnonymousId();

        expect(newId).toBeNull();
        expect(mockCoreResetAnonymousId).not.toHaveBeenCalled();
      });
    });

    describe('resetIdentity', () => {
      beforeEach(async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushAsync();
        jest.clearAllMocks();
      });

      it('should call resetIdentity without options for a plain reset', () => {
        MostlyGoodMetrics.resetIdentity();

        expect(mockCore.resetIdentity).toHaveBeenCalledWith(undefined);
      });

      it('should pass forget-me options through to the JS SDK', () => {
        MostlyGoodMetrics.resetIdentity({ clearAnonymousId: true });

        expect(mockCore.resetIdentity).toHaveBeenCalledWith({ clearAnonymousId: true });
        expect(mockPreferences.remove).toHaveBeenCalledWith({
          key: 'mostlygoodmetrics_user_id',
        });
      });

      it('should clear sticky local experiment assignments on forget-me', () => {
        const removeItem = jest.fn();
        (globalThis as { localStorage?: unknown }).localStorage = { removeItem };

        try {
          MostlyGoodMetrics.resetIdentity({ clearAnonymousId: true });

          expect(removeItem).toHaveBeenCalledWith('mgm_local_experiment_assignments');
        } finally {
          delete (globalThis as { localStorage?: unknown }).localStorage;
        }
      });

      it('should keep sticky local experiment assignments on a plain resetIdentity', () => {
        const removeItem = jest.fn();
        (globalThis as { localStorage?: unknown }).localStorage = { removeItem };

        try {
          MostlyGoodMetrics.resetIdentity();

          expect(removeItem).not.toHaveBeenCalledWith('mgm_local_experiment_assignments');
        } finally {
          delete (globalThis as { localStorage?: unknown }).localStorage;
        }
      });
    });

    describe('collectDeviceProperties', () => {
      it('should include device properties by default', async () => {
        MostlyGoodMetrics.configure('test-api-key');
        await flushAsync();
        jest.clearAllMocks();

        MostlyGoodMetrics.track('with_device');

        const [, props] = mockTrack.mock.calls[0];
        expect(props['$device_type']).toBe('phone');
        expect(props['$device_model']).toBe('iPhone 14');
      });

      it('should omit device properties and pass the flag to the JS SDK when disabled', async () => {
        MostlyGoodMetrics.configure('test-api-key', { collectDeviceProperties: false });
        await flushAsync();

        const configArg = mockConfigure.mock.calls[0][0];
        expect(configArg.collectDeviceProperties).toBe(false);

        jest.clearAllMocks();

        MostlyGoodMetrics.track('without_device');

        const [, props] = mockTrack.mock.calls[0];
        expect(props['$device_type']).toBeUndefined();
        expect(props['$device_model']).toBeUndefined();
        expect(props['$storage_type']).toBeDefined();
      });
    });
  });

  describe('local experiment enrollment', () => {
    const localExperiments = [
      {
        id: '7b1e8a90-4c2d-4f6a-9e3b-2a1d5c8f0e71',
        name: 'button-color',
        variants: ['control', 'treatment'],
      },
    ];

    it('should pass experimentMode and localExperiments through to the JS SDK', async () => {
      MostlyGoodMetrics.configure('test-api-key', {
        experimentMode: 'local',
        localExperiments,
      });
      await flushInit();

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.experimentMode).toBe('local');
      expect(configArg.localExperiments).toEqual(localExperiments);
    });

    it('should not set an experiment mode by default (JS SDK defaults to server)', async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();

      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.experimentMode).toBeUndefined();
    });
  });

  describe('A/B testing', () => {
    beforeEach(async () => {
      MostlyGoodMetrics.configure('test-api-key');
      await flushInit();
      jest.clearAllMocks();
    });

    it('should call getVariant on the JS SDK with a null default fallback', () => {
      mockGetVariant.mockReturnValue('variant-a');

      const result = MostlyGoodMetrics.getVariant('my-experiment');

      expect(mockGetVariant).toHaveBeenCalledTimes(1);
      expect(mockGetVariant).toHaveBeenCalledWith('my-experiment', null);
      expect(result).toBe('variant-a');
    });

    it('should pass the fallback through to the JS SDK', () => {
      mockGetVariant.mockReturnValue('control');

      const result = MostlyGoodMetrics.getVariant('my-experiment', 'control');

      expect(mockGetVariant).toHaveBeenCalledWith('my-experiment', 'control');
      expect(result).toBe('control');
    });

    it('should return the fallback when SDK is not configured', () => {
      MostlyGoodMetrics.destroy();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = MostlyGoodMetrics.getVariant('my-experiment', 'control');

      expect(mockGetVariant).not.toHaveBeenCalled();
      expect(result).toBe('control');
      warnSpy.mockRestore();
    });

    it('should call ready on the JS SDK', async () => {
      mockReady.mockResolvedValue(undefined);

      await MostlyGoodMetrics.ready();

      expect(mockReady).toHaveBeenCalledTimes(1);
    });

    it('should not call ready when SDK is not configured', async () => {
      MostlyGoodMetrics.destroy();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await MostlyGoodMetrics.ready();

      expect(mockReady).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
