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
    setSuperProperty: mockSetSuperProperty,
    setSuperProperties: mockSetSuperProperties,
    removeSuperProperty: mockRemoveSuperProperty,
    clearSuperProperties: mockClearSuperProperties,
    getSuperProperties: mockGetSuperProperties,
  },
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

describe('MostlyGoodMetrics Capacitor SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset platform mock
    (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');
    // Reset the SDK state
    MostlyGoodMetrics.destroy();
  });

  describe('configure', () => {
    it('should pass platform as ios when Capacitor platform is ios', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('ios');
    });

    it('should pass platform as android when Capacitor platform is android', () => {
      (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');

      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('android');
    });

    it('should pass platform as web when Capacitor platform is web', () => {
      (Capacitor.getPlatform as jest.Mock).mockReturnValue('web');

      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.platform).toBe('web');
    });

    it('should pass sdk as capacitor', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.sdk).toBe('capacitor');
    });

    it('should disable JS SDK lifecycle tracking', () => {
      MostlyGoodMetrics.configure('test-api-key');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.trackAppLifecycleEvents).toBe(false);
    });

    it('should pass through custom config options', () => {
      MostlyGoodMetrics.configure('test-api-key', {
        environment: 'staging',
        maxBatchSize: 50,
        flushInterval: 15,
      });

      expect(mockConfigure).toHaveBeenCalledTimes(1);
      const configArg = mockConfigure.mock.calls[0][0];
      expect(configArg.environment).toBe('staging');
      expect(configArg.maxBatchSize).toBe(50);
      expect(configArg.flushInterval).toBe(15);
    });

    it('should not configure twice', () => {
      MostlyGoodMetrics.configure('test-api-key');
      MostlyGoodMetrics.configure('test-api-key-2');

      expect(mockConfigure).toHaveBeenCalledTimes(1);
    });
  });

  describe('track', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure('test-api-key');
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
    beforeEach(() => {
      MostlyGoodMetrics.configure('test-api-key');
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
    it('should reset configuration state', () => {
      MostlyGoodMetrics.configure('test-api-key');
      jest.clearAllMocks();

      MostlyGoodMetrics.destroy();
      MostlyGoodMetrics.configure('test-api-key-2');

      // Should be able to configure again after destroy
      expect(mockConfigure).toHaveBeenCalledTimes(1);
    });
  });
});
