import MGM from '@mgm/candidate-wrapper';
import { MostlyGoodMetrics as Core, SystemEvents } from '@mostly-good-metrics/javascript';
import { Preferences } from '@capacitor/preferences';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';

const result = document.getElementById('result');
const errors = [];
window.addEventListener('error', e => errors.push(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(ok, label) { if (!ok) throw new Error(label); console.log('MGM_NATIVE_CHECK:' + label); }
const config = { apiKey: 'offline-native-test', baseURL: 'http://127.0.0.1:1', environment: 'test',
  localExperiments: [], experimentMode: 'local', trackAppLifecycleEvents: true, maxBatchSize: 1000,
  flushInterval: 3600, maxStoredEvents: 100,
  networkClient: { async sendEvents() { return { success: false, shouldRetry: true }; } } };
// No analytics requests can leave this isolated host.
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error('Network intentionally disabled in native host'); };

function configure() {
  const { apiKey, ...options } = config;
  MGM.configure(apiKey, options);
}

async function run() {
  const info = await Device.getInfo();
  check(info.platform === 'android', 'real-device-plugin');
  await Preferences.clear(); // This generated app owns a separate native preferences sandbox.
  localStorage.clear();
  configure();
  await MGM.ready(5000);
  check(Core.shared !== null, 'native-initialization');
  check(Core.shared.config.baseURL === config.baseURL && Core.shared.config.localExperiments.length === 0, 'configured-offline-options');
  const anon = Core.shared.anonymousId;
  const cyclic = []; cyclic.push(cyclic);
  MGM.track('native_capture', { nested: cyclic });
  await delay(250);
  check(await MGM.getPendingEventCount() > 0, 'real-preferences-event-store');
  MGM.identify('isolated-test-user');
  await delay(250);
  MGM.destroy();
  configure();
  await MGM.ready(5000);
  check(Core.shared.anonymousId === anon, 'identity-survives-reconfigure');
  check(Core.shared.userId === 'isolated-test-user', 'stored-user-restored');
  for (let i = 0; i < 30; i++) {
    MGM.destroy(); configure(); await MGM.ready(5000);
    check(Core.shared.anonymousId === anon, 'identity-cycle-' + i);
  }
  MGM.optOut(); await delay(250);
  check(await MGM.getPendingEventCount() === 0, 'opt-out-clears-native-queue');
  MGM.destroy(); configure(); await MGM.ready(5000);
  check(MGM.isOptedOut(), 'native-opt-out-survives-reconfigure');
  MGM.optIn(); await delay(100);
  MGM.track('native_recovery'); await delay(250);
  check(await MGM.getPendingEventCount() > 0, 'explicit-opt-in-recovers');
  await Core.shared.clearPendingEvents();
  const nativeStore = Core.shared.storage;
  let phase = 'active';
  let finishing = false;
  const stateEvents = [];
  const listener = await App.addListener('appStateChange', ({ isActive }) => {
    stateEvents.push(isActive);
    console.log('MGM_NATIVE_STATE:' + phase + ':' + isActive);
    if (stateEvents.includes(false) && stateEvents.includes(true) && !finishing) {
      finishing = true;
      void globalThis.finishNativeLifecycle?.().catch(e => {
      result.textContent = 'FAIL ' + String(e.stack ?? e); console.error('MGM_NATIVE_FAIL:' + result.textContent);
      }).finally(() => { finishing = false; });
    }
  });
  globalThis.finishNativeLifecycle = async () => {
    if (!(stateEvents.includes(false) && stateEvents.includes(true))) return;
    check(stateEvents.includes(false) && stateEvents.includes(true), 'real-background-foreground');
    if (phase === 'active') {
      await delay(150);
      const events = await nativeStore.fetchEvents(100);
      check(events.some(event => event.name === SystemEvents.APP_BACKGROUNDED), 'sdk-background-event');
      check(events.some(event => event.name === SystemEvents.APP_OPENED), 'sdk-foreground-event');
      MGM.destroy();
      phase = 'destroyed';
      stateEvents.length = 0;
      console.log('MGM_NATIVE_DESTROYED_READY');
      return;
    }
    if (phase === 'destroyed') {
      check(Core.shared === null, 'teardown-does-not-recreate-client');
      check(await nativeStore.eventCount() === 0, 'abandoned-adapter-remains-inert');
      const { apiKey, ...options } = config;
      MGM.configure(apiKey, { ...options, trackAppLifecycleEvents: false });
      await MGM.ready(5000);
      await Core.shared.clearPendingEvents();
      phase = 'disabled';
      stateEvents.length = 0;
      console.log('MGM_NATIVE_DISABLED_READY');
      return;
    }
    const disabledEvents = await Core.shared.storage.fetchEvents(100);
    check(!disabledEvents.some(event => event.name === SystemEvents.APP_BACKGROUNDED || event.name === SystemEvents.APP_OPENED), 'disabled-sdk-lifecycle-no-capture');
    MGM.destroy();
    await listener.remove();
    await delay(100);
    check(fetchCalls === 0, 'zero-fetch-calls');
    check(errors.length === 0, 'no-host-errors');
    result.textContent = 'PASS real Android Capacitor plugins, identity, consent, SDK lifecycle and teardown';
    console.log('MGM_NATIVE_PASS:' + result.textContent);
  };
  result.textContent = 'READY for native lifecycle';
  console.log('MGM_NATIVE_READY');
}
run().catch(e => { result.textContent = 'FAIL ' + String(e.stack ?? e); console.error('MGM_NATIVE_FAIL:' + result.textContent); });
