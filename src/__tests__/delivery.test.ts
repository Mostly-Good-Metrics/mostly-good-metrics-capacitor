/**
 * End-to-end delivery regression tests.
 *
 * Unlike index.test.ts, these DO NOT mock @mostly-good-metrics/javascript: the
 * real JS core is wired to the real CapacitorPreferencesStorage so we can
 * observe events all the way to the network. A fake network client counts the
 * events actually sent.
 *
 * Covers:
 *  - Bug 1: a synchronous burst of tracked events (mirroring the wrapper
 *    replaying queued events before init finishes) must all persist and flush,
 *    with none lost to the storage read-modify-write race.
 *  - Bug 2: `await flush()` must resolve only after the events have been sent.
 */

import type { INetworkClient } from '@mostly-good-metrics/javascript';

// --- Capacitor plugin mocks -------------------------------------------------

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: jest.fn(() => 'ios'),
  },
}));

jest.mock('@capacitor/app', () => ({
  App: {
    addListener: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  },
}));

jest.mock('@capacitor/device', () => ({
  Device: {
    getInfo: jest.fn().mockResolvedValue({ model: 'iPhone 14', osVersion: '17.0' }),
  },
}));

// Real in-memory backing store so persistence behaves like the device.
const prefsBacking: Record<string, string> = {};
jest.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: jest.fn(async ({ key }: { key: string }) => ({ value: prefsBacking[key] ?? null })),
    set: jest.fn(async ({ key, value }: { key: string; value: string }) => {
      prefsBacking[key] = value;
    }),
    remove: jest.fn(async ({ key }: { key: string }) => {
      delete prefsBacking[key];
    }),
  },
}));

import MostlyGoodMetrics from '../index';

/** Counting network client — records how many events are actually sent. */
class CountingNetworkClient implements INetworkClient {
  public sentEventCount = 0;
  public sendCalls = 0;

  async sendEvents(payload: { events: unknown[] }): Promise<{ success: true }> {
    this.sendCalls += 1;
    this.sentEventCount += payload.events.length;
    return { success: true };
  }

  isRateLimited(): boolean {
    return false;
  }

  getRetryAfterTime(): Date | null {
    return null;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('reliable event delivery (real core + real storage)', () => {
  let network: CountingNetworkClient;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(prefsBacking)) delete prefsBacking[key];
    MostlyGoodMetrics.destroy();
    network = new CountingNetworkClient();

    // Avoid real experiment network traffic; ready() will resolve quickly.
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('network disabled in test'));
  });

  afterEach(() => {
    MostlyGoodMetrics.destroy();
  });

  const configure = async () => {
    MostlyGoodMetrics.configure('test-api-key', {
      environment: 'test',
      trackAppLifecycleEvents: false,
      // Large batch/interval so nothing auto-flushes mid-burst.
      maxBatchSize: 1000,
      flushInterval: 3600,
      // Cast: networkClient is a valid core option not surfaced on CapacitorConfig.
      networkClient: network,
    } as never);
    // Wait for opt-out resolution + JS client construction.
    await MostlyGoodMetrics.ready(2000);
    await settle();
  };

  it('persists and sends every event from a synchronous burst (Bug 1)', async () => {
    await configure();

    // Fire a synchronous burst — this is what the wrapper does when replaying
    // queued events. Each track() drives a concurrent storage.store().
    const BURST = 12;
    for (let i = 0; i < BURST; i++) {
      MostlyGoodMetrics.track(`burst_event_${i}`);
    }

    // Let the fire-and-forget storage writes settle, then flush.
    await settle();
    await MostlyGoodMetrics.flush();

    expect(network.sentEventCount).toBe(BURST);
    // Nothing left pending — a real POST went out for every event.
    expect(await MostlyGoodMetrics.getPendingEventCount()).toBe(0);
  });

  it('await flush() resolves only after events are sent (Bug 2)', async () => {
    await configure();

    MostlyGoodMetrics.track('single_event');
    await settle();

    const result = MostlyGoodMetrics.flush();
    expect(result).toBeInstanceOf(Promise);

    // Not yet sent synchronously; only after awaiting.
    await result;
    expect(network.sentEventCount).toBe(1);
    expect(network.sendCalls).toBeGreaterThanOrEqual(1);
  });
});
