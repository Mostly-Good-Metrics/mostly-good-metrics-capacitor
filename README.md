# MostlyGoodMetrics Capacitor SDK

The official Capacitor SDK for [MostlyGoodMetrics](https://mostlygoodmetrics.com) analytics.

## Installation

```bash
npm install @mostly-good-metrics/capacitor
```

### Required Peer Dependencies

The SDK requires the following Capacitor plugins:

```bash
npm install @capacitor/core @capacitor/app @capacitor/device @capacitor/preferences
npx cap sync
```

## Usage

### Initialize the SDK

Initialize the SDK as early as possible in your app, typically in your main entry file:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/capacitor';

MostlyGoodMetrics.configure('your-api-key', {
  appVersion: '1.0.0', // Required for install/update tracking
  environment: 'production',
});
```

### Track Events

```typescript
MostlyGoodMetrics.track('button_clicked', {
  button_name: 'signup',
  screen: 'home',
});
```

### Identify Users

```typescript
MostlyGoodMetrics.identify('user-123');
```

### Super Properties

Set properties that will be included with every event:

```typescript
// Set a single super property
MostlyGoodMetrics.setSuperProperty('plan', 'premium');

// Set multiple super properties
MostlyGoodMetrics.setSuperProperties({
  plan: 'premium',
  tier: 'gold',
});

// Remove a super property
MostlyGoodMetrics.removeSuperProperty('plan');

// Clear all super properties
MostlyGoodMetrics.clearSuperProperties();
```

### Manual Flush

Force send pending events to the server:

```typescript
MostlyGoodMetrics.flush();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appVersion` | string | - | App version for install/update tracking |
| `environment` | string | `'production'` | Environment name |
| `maxBatchSize` | number | `100` | Max events per batch |
| `flushInterval` | number | `30` | Seconds between auto-flushes |
| `maxStoredEvents` | number | `10000` | Max events to store locally |
| `enableDebugLogging` | boolean | `false` | Enable console logging |
| `trackAppLifecycleEvents` | boolean | `true` | Track app open/background events |

## Automatic Tracking

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

- `$app_installed` - First launch after install
- `$app_updated` - First launch after app version change
- `$app_opened` - App came to foreground
- `$app_backgrounded` - App went to background

## Platform Support

- iOS
- Android
- Web (with limited lifecycle tracking)

## License

MIT
