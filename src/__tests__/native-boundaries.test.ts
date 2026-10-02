const mockStore = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };
const mockLifecycle = { add: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
const mockDevice = { getInfo: jest.fn() };
const mockCore = {
  configure: jest.fn(), track: jest.fn(), identify: jest.fn(), resetIdentity: jest.fn(), reset: jest.fn(),
  isConfigured: false, shared: null,
  ready: jest.fn().mockResolvedValue(undefined), flush: jest.fn().mockResolvedValue(undefined),
  getVariant: jest.fn(), getSuperProperties: jest.fn(), getPendingEventCount: jest.fn().mockResolvedValue(0),
  clearPendingEvents: jest.fn().mockResolvedValue(undefined), startNewSession: jest.fn(),
  optOut: jest.fn(), optIn: jest.fn(), resetAnonymousId: jest.fn().mockReturnValue('rotated'),
};
jest.mock('@mostly-good-metrics/javascript', () => ({
  MostlyGoodMetrics: mockCore, generateAnonymousId: jest.fn(() => 'generated-id'),
  SystemEvents: { APP_OPENED: '$app_opened', APP_BACKGROUNDED: '$app_backgrounded', APP_INSTALLED: '$app_installed', APP_UPDATED: '$app_updated' },
  SystemProperties: { DEVICE_TYPE: '$device_type', DEVICE_MODEL: '$device_model', VERSION: '$version', PREVIOUS_VERSION: '$previous_version', SDK: '$sdk' },
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
jest.mock('@capacitor/preferences', () => ({ Preferences: { get: (...args: unknown[]) => mockStore.get(...args), set: (...args: unknown[]) => mockStore.set(...args), remove: (...args: unknown[]) => mockStore.remove(...args) } }));
jest.mock('@capacitor/device', () => ({ Device: mockDevice }));
jest.mock('@capacitor/app', () => ({ App: { addListener: (...args: unknown[]) => mockLifecycle.add(...args) } }));
import SDK from '../index';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const stored = (value: string | null) => ({ value });

describe('native startup and teardown boundaries', () => {
  beforeEach(() => {
    SDK.destroy();
    jest.clearAllMocks();
    mockStore.get.mockResolvedValue(stored(null));
    mockStore.set.mockResolvedValue(undefined);
    mockStore.remove.mockResolvedValue(undefined);
    mockLifecycle.add.mockResolvedValue({ remove: mockLifecycle.remove });
    mockDevice.getInfo.mockResolvedValue({ model: 'test', osVersion: '27.0' });
    mockCore.ready.mockResolvedValue(undefined);
    mockCore.flush.mockResolvedValue(undefined);
  });
  afterEach(async () => { SDK.destroy(); await settle(); jest.useRealTimers(); });

  it('bounds ready across native initialization and caps retained startup calls', async () => {
    jest.useFakeTimers();
    const read = deferred<{ value: string | null }>();
    mockStore.get.mockReturnValueOnce(read.promise);
    SDK.configure('test', { trackAppLifecycleEvents: false });
    for (let i = 0; i < 25000; i++) SDK.track(`queued_${i}`);
    const state = (globalThis as unknown as { __MGM_CAPACITOR_STATE__: { pendingClientCalls: unknown[] } }).__MGM_CAPACITOR_STATE__;
    expect(state.pendingClientCalls.length).toBeLessThanOrEqual(10000);
    let ready = false;
    const waiting = SDK.ready(25).then(() => { ready = true; });
    await jest.advanceTimersByTimeAsync(25);
    expect(ready).toBe(true);
    expect(mockCore.ready).not.toHaveBeenCalled();
    SDK.destroy();
    read.resolve(stored(null));
    await settle();
    await waiting;
    expect(mockCore.configure).not.toHaveBeenCalled();
  });

  it('preserves explicit consent when an older native consent read resolves later', async () => {
    const read = deferred<{ value: string | null }>();
    mockStore.get.mockImplementation(({ key }: { key: string }) => key === 'mostlygoodmetrics_opt_out' ? read.promise : Promise.resolve(stored(null)));
    SDK.configure('test', { trackAppLifecycleEvents: false });
    SDK.optOut();
    read.resolve(stored('false'));
    await settle();
    expect(SDK.isOptedOut()).toBe(true);
    expect(mockCore.configure.mock.calls[0][0].optedOutByDefault).toBe(true);
  });

  it('coalesces reads and never persists identities from 40 destroyed configurations', async () => {
    const backing = new Map<string, string>();
    const old = deferred<ReturnType<typeof stored>>();
    mockStore.get.mockImplementation(({ key }: { key: string }) => key === 'mostlygoodmetrics_anonymous_id' ? old.promise : Promise.resolve(stored(backing.get(key) ?? null)));
    mockStore.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => { backing.set(key, value); });
    for (let i = 0; i < 40; i++) {
      SDK.configure(`old_${i}`, { trackAppLifecycleEvents: false });
      SDK.track('abandoned');
      await settle();
      SDK.destroy();
    }
    SDK.configure('current', { anonymousId: 'current-anon', trackAppLifecycleEvents: false });
    await settle();
    old.resolve(stored(null));
    await settle();
    expect(mockStore.get.mock.calls.filter(([entry]) => entry.key === 'mostlygoodmetrics_anonymous_id')).toHaveLength(1);
    expect(mockCore.configure).toHaveBeenCalledTimes(1);
    expect(mockCore.configure.mock.calls[0][0].apiKey).toBe('current');
    expect(mockCore.track).not.toHaveBeenCalled();
    expect(backing.get('mostlygoodmetrics_anonymous_id')).toBe('current-anon');
  });

  it('stops initialization if tracking reentrantly destroys the SDK', async () => {
    mockCore.track.mockImplementationOnce(() => SDK.destroy());
    SDK.configure('test');
    SDK.track('reentrant');
    SDK.track('must-not-replay');
    await settle();
    expect(mockCore.track).toHaveBeenCalledTimes(1);
    expect(mockLifecycle.add).not.toHaveBeenCalled();
  });

  it('coalesces 2000 native mutations behind a stalled write and quarantines it after timeout', async () => {
    jest.useFakeTimers();
    await jest.isolateModulesAsync(async () => {
      const isolated = (await import('../storage')).persistence;
      const first = deferred<void>();
      mockStore.set.mockReturnValueOnce(first.promise);
      const writes = [isolated.setUserId('initial')];
      await settle();
      for (let i = 0; i < 2000; i++) writes.push(isolated.setUserId(`latest_${i}`));
      expect(mockStore.set).toHaveBeenCalledTimes(1);
      await expect(isolated.getUserId()).resolves.toBe('latest_1999');
      await jest.advanceTimersByTimeAsync(5000);
      await Promise.all(writes);
      first.resolve(undefined);
      await settle();
      await isolated.setUserId('after-timeout');
      await expect(isolated.getUserId()).resolves.toBe('after-timeout');
      expect(mockStore.set).toHaveBeenCalledTimes(1);
    });
  });

  it('fails closed when native consent cannot be read, then honors explicit opt-in', async () => {
    await jest.isolateModulesAsync(async () => {
      const isolated = (await import('../storage')).persistence;
      mockStore.get.mockRejectedValue(new Error('native preferences unavailable'));
      await expect(isolated.getOptOut()).resolves.toBe(true);
      await isolated.setOptOut(false);
      await expect(isolated.getOptOut()).resolves.toBe(false);
    });
  });

  it('bounds device metadata startup and ignores late device completion after teardown', async () => {
    jest.useFakeTimers();
    const device = deferred<{ model: string; osVersion: string }>();
    mockDevice.getInfo.mockReturnValueOnce(device.promise);
    SDK.configure('test', { trackAppLifecycleEvents: false });
    await jest.advanceTimersByTimeAsync(5000);
    await settle();
    expect(mockCore.configure).toHaveBeenCalledTimes(1);
    SDK.destroy();
    device.resolve({ model: 'stale', osVersion: 'stale' });
    await settle();
    expect(mockCore.configure).toHaveBeenCalledTimes(1);
  });


  it('bounds startup payload bytes and takes owned nested snapshots', async () => {
    const read = deferred<ReturnType<typeof stored>>();
    mockStore.get.mockReturnValueOnce(read.promise);
    SDK.configure('test', { trackAppLifecycleEvents: false });
    const properties = { nested: { value: 'before' }, payload: 'x'.repeat(10000) };
    for (let i = 0; i < 2000; i++) SDK.track('large_valid', properties);
    const state = (globalThis as unknown as { __MGM_CAPACITOR_STATE__: { pendingClientCalls: unknown[]; pendingClientBytes: number } }).__MGM_CAPACITOR_STATE__;
    expect(state.pendingClientBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(state.pendingClientCalls.length).toBeLessThan(100);
    properties.nested.value = 'after';
    read.resolve(stored(null));
    await settle();
    expect(mockCore.track).toHaveBeenCalled();
    expect(mockCore.track.mock.calls[0][1].nested.value).toBe('before');
  });

  it('immediately releases readiness and flush waiters on teardown', async () => {
    const read = deferred<ReturnType<typeof stored>>();
    mockStore.get.mockReturnValueOnce(read.promise);
    SDK.configure('test', { trackAppLifecycleEvents: false });
    const waiting = Promise.all([SDK.ready(60000), SDK.flush(), SDK.getPendingEventCount()]);
    SDK.destroy();
    await expect(waiting).resolves.toEqual([undefined, undefined, 0]);
    read.resolve(stored(null));
    await settle();
  });


  it('bounds outstanding native listener registrations across 40 reconfigurations', async () => {
    const listener = deferred<{ remove: () => Promise<void> }>();
    mockLifecycle.add.mockReturnValueOnce(listener.promise);
    for (let i = 0; i < 40; i++) {
      SDK.configure(`listener_${i}`);
      await settle();
      SDK.destroy();
    }
    SDK.configure('current-listener');
    await settle();
    expect(mockLifecycle.add).toHaveBeenCalledTimes(1);
    const oldRemove = jest.fn().mockResolvedValue(undefined);
    listener.resolve({ remove: oldRemove });
    await settle();
    expect(oldRemove).toHaveBeenCalledTimes(1);
    expect(mockLifecycle.add).toHaveBeenCalledTimes(2);
  });


  it('bounds native listeners while an uncancelable removal is stalled', async () => {
    const removal = deferred<void>();
    mockLifecycle.remove.mockReturnValueOnce(removal.promise);
    SDK.configure('initial');
    await settle();
    const oldCallback = mockLifecycle.add.mock.calls[0][1];
    SDK.destroy();
    for (let i = 0; i < 40; i++) {
      SDK.configure(`removal_${i}`);
      await settle();
      SDK.destroy();
    }
    SDK.configure('current-removal');
    await settle();
    expect(mockLifecycle.add).toHaveBeenCalledTimes(1);
    expect(mockLifecycle.remove).toHaveBeenCalledTimes(1);
    const before = mockCore.track.mock.calls.length;
    oldCallback({ isActive: false });
    expect(mockCore.track).toHaveBeenCalledTimes(before);
    removal.resolve(undefined);
    await settle();
    expect(mockLifecycle.add).toHaveBeenCalledTimes(2);
  });


  it('invalidates event storage on destroy and preserves a repeated configure no-op', async () => {
    SDK.configure('first', { trackAppLifecycleEvents: false });
    await settle();
    const storage = mockCore.configure.mock.calls[0][0].storage;
    const event = { name: 'accepted', timestamp: '2026-10-02', client_event_id: 'accepted', user_id: 'test', platform: 'ios', environment: 'test' };
    await storage.store(event);
    SDK.configure('ignored');
    expect(await storage.eventCount()).toBe(1);
    SDK.destroy();
    await storage.store({ ...event, name: 'after-destroy' });
    expect(await storage.eventCount()).toBe(0);
  });


  it('fails closed for malformed native consent and recovers after explicit opt-in', async () => {
    await jest.isolateModulesAsync(async () => {
      const isolated = (await import('../storage')).persistence;
      mockStore.get.mockResolvedValueOnce(stored(null));
      await expect(isolated.getOptOut()).resolves.toBeNull();
      mockStore.get.mockResolvedValueOnce(stored('damaged-consent'));
      await expect(isolated.getOptOut()).resolves.toBe(true);
      await isolated.setOptOut(false);
      mockStore.get.mockResolvedValueOnce(stored('false'));
      await expect(isolated.getOptOut()).resolves.toBe(false);
    });
  });

  it('returns safe getter fallbacks and completes teardown when the core throws', async () => {
    SDK.configure('test', { trackAppLifecycleEvents: false });
    await settle();
    mockCore.getVariant.mockImplementationOnce(() => { throw new Error('bad variant'); });
    mockCore.getSuperProperties.mockImplementationOnce(() => { throw new Error('bad properties'); });
    mockCore.reset.mockImplementationOnce(() => { throw new Error('bad cleanup'); });
    expect(SDK.getVariant('experiment', 'fallback')).toBe('fallback');
    expect(SDK.getSuperProperties()).toEqual({});
    expect(() => SDK.destroy()).not.toThrow();
    SDK.configure('next', { trackAppLifecycleEvents: false });
    await settle();
    expect(mockCore.configure).toHaveBeenCalledTimes(2);
  });
});

it('restores native user identity before replaying startup events', async () => {
  SDK.destroy(); jest.clearAllMocks();
  mockStore.get.mockImplementation(({ key }: { key: string }) => Promise.resolve(stored(key === 'mostlygoodmetrics_user_id' ? 'restored-user' : null)));
  mockStore.set.mockResolvedValue(undefined); mockDevice.getInfo.mockResolvedValue({});
  SDK.configure('test', { trackAppLifecycleEvents: false });
  SDK.track('queued');
  await settle();
  expect(mockCore.identify).toHaveBeenCalledWith('restored-user');
  expect(mockCore.identify.mock.invocationCallOrder[0]).toBeLessThan(mockCore.track.mock.invocationCallOrder[0]!);
  SDK.destroy();
});
