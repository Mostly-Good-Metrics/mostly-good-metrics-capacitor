# MostlyGoodMetrics Capacitor SDK

A lightweight Capacitor SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Requirements

- Capacitor 5.0+
- iOS 13+ / Android 5.0+ / Modern browser
- Node.js 16+ (for build tools)

## Installation

```bash
npm install @mostly-good-metrics/capacitor
```

Or with yarn:

```bash
yarn add @mostly-good-metrics/capacitor
```

### Required Peer Dependencies

The SDK requires the following Capacitor plugins:

```bash
npm install @capacitor/core @capacitor/app @capacitor/device @capacitor/preferences
npx cap sync
```

## Quick Start

### 1. Initialize the SDK

Initialize once at app startup:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/capacitor';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: '1.0.0', // Required for install/update tracking
  environment: 'production',
});
```

### 2. Track Events

```typescript
// Simple event
MostlyGoodMetrics.track('button_clicked');

// Event with properties
MostlyGoodMetrics.track('purchase_completed', {
  product_id: 'SKU123',
  price: 29.99,
  currency: 'USD',
});
```

### 3. Identify Users

```typescript
// Set user identity
MostlyGoodMetrics.identify('user_123');

// Reset identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

That's it! Events are automatically batched and sent.

## Configuration Options

```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  baseURL: 'https://mostlygoodmetrics.com',
  appVersion: '1.0.0',
  environment: 'production',
  maxBatchSize: 100,
  flushInterval: 30,
  maxStoredEvents: 10000,
  enableDebugLogging: false,
  trackAppLifecycleEvents: true,
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `baseURL` | `"https://mostlygoodmetrics.com"` | API base URL |
| `appVersion` | - | App version string (required for install/update tracking) |
| `environment` | `"production"` | Environment name |
| `maxBatchSize` | `100` | Events per batch (1-1000) |
| `flushInterval` | `30` | Auto-flush interval in seconds |
| `maxStoredEvents` | `10000` | Max cached events |
| `enableDebugLogging` | `false` | Enable console output |
| `trackAppLifecycleEvents` | `true` | Auto-track lifecycle events |

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App came to foreground | - |
| `$app_backgrounded` | App went to background | - |

> **Note:** Install and update detection require `appVersion` to be configured.

## Automatic Context

The SDK automatically includes context with every event:

| Property | Description |
|----------|-------------|
| `$device_type` | Device type (`phone`, `tablet`, `desktop`) |
| `$device_model` | Device model (e.g., `iPhone14,2`) |
| `$os_name` | Operating system name (e.g., `iOS`, `Android`, `Web`) |
| `$os_version` | Operating system version |
| `$app_version` | App version (if configured) |
| `$environment` | Environment name (e.g., `production`) |
| `$session_id` | Unique session identifier |
| `$storage_type` | Storage type (`persistent` or `memory`) |
| `$sdk_name` | SDK identifier (`capacitor`) |
| `$sdk_version` | SDK version |

## Event Naming

Event names must follow these rules:

1. Start with a letter (a-z, A-Z) or `$` for system events
2. Contain only alphanumeric characters (a-z, A-Z, 0-9) and underscores
3. Be 255 characters or less

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');     // lowercase with underscore
MostlyGoodMetrics.track('PurchaseCompleted');  // camelCase
MostlyGoodMetrics.track('step_1_completed');   // numbers after first char

// Invalid
MostlyGoodMetrics.track('123_event');   // starts with number
MostlyGoodMetrics.track('event-name');  // contains hyphen
MostlyGoodMetrics.track('event name');  // contains space
```

> **Note:** Events with invalid names will be ignored. The `$` prefix is reserved for system events like `$app_opened`.

## Properties

Events support various property types:

```typescript
MostlyGoodMetrics.track('checkout', {
  string_prop: 'value',
  int_prop: 42,
  double_prop: 3.14,
  bool_prop: true,
  null_prop: null,
  list_prop: ['a', 'b', 'c'],
  nested: {
    key: 'value',
  },
});
```

**Limits:**
- String values: truncated to 1000 characters
- Nesting depth: max 3 levels
- Total properties size: max 10KB

## User Identification

### identify()

Associate events with a specific user:

```typescript
// Identify with user ID only
MostlyGoodMetrics.identify('user_123');

// Identify with profile data
MostlyGoodMetrics.identify('user_123', {
  email: 'user@example.com',
  name: 'John Doe',
});
```

### resetIdentity()

Clear the current user identity (e.g., on logout):

```typescript
MostlyGoodMetrics.resetIdentity();
```

User IDs are persisted across app sessions using Capacitor Preferences.

## Manual Flush

Events are automatically flushed periodically and when the app goes to background. You can also trigger a manual flush:

```typescript
// Flush all pending events
await MostlyGoodMetrics.flush();
```

To check pending events before flushing:

```typescript
const count = await MostlyGoodMetrics.getPendingEventCount();
console.log(`${count} events pending`);

if (count > 0) {
  await MostlyGoodMetrics.flush();
}
```

Common use cases for manual flush:
- Before navigating to an external URL
- Before a critical user action completes
- When the user explicitly logs out

## Super Properties

Set properties that will be included with every event:

```typescript
// Set a single super property
MostlyGoodMetrics.setSuperProperty('plan', 'premium');

// Set multiple super properties
MostlyGoodMetrics.setSuperProperties({
  plan: 'premium',
  tier: 'gold',
});

// Get all super properties
const props = MostlyGoodMetrics.getSuperProperties();

// Remove a super property
MostlyGoodMetrics.removeSuperProperty('plan');

// Clear all super properties
MostlyGoodMetrics.clearSuperProperties();
```

## Automatic Behavior

The SDK automatically:

- **Persists** events to Capacitor Preferences (with in-memory fallback)
- **Batches** events for efficient network usage
- **Flushes** periodically (default: every 30 seconds)
- **Flushes** when the app goes to background
- **Compresses** payloads using gzip for large batches (>1KB)
- **Retries** failed requests with exponential backoff
- **Handles** rate limiting gracefully
- **Persists** user identity across app sessions
- **Generates** unique session IDs per app launch
- **Deduplicates** lifecycle events that fire in quick succession

## Debug Logging

Enable debug logging to see SDK activity:

```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  enableDebugLogging: true,
});
```

Example output:

```
[MostlyGoodMetrics] Configured with baseURL: https://mostlygoodmetrics.com
[MostlyGoodMetrics] Device info: {model: "iPhone14,2", osVersion: "16.0", platform: "ios"}
[MostlyGoodMetrics] Event tracked: $app_opened
[MostlyGoodMetrics] User identified: user_123
[MostlyGoodMetrics] Flushing 5 events
[MostlyGoodMetrics] Flush complete: 5 events sent
```

## A/B Testing

The SDK supports server-side A/B testing with consistent variant assignment:

```typescript
// Wait for experiments to load
await MostlyGoodMetrics.ready();

// Get the variant for an experiment
const variant = MostlyGoodMetrics.getVariant('button-color');

if (variant === 'a') {
  // Show red button
} else if (variant === 'b') {
  // Show blue button
}
```

## Session Management

Start a new session manually:

```typescript
MostlyGoodMetrics.startNewSession();
```

## Platform Support

- iOS
- Android
- Web (with limited lifecycle tracking)

> **Note:** On web, lifecycle events rely on page visibility API. The `@capacitor/app` plugin is required for full lifecycle tracking on iOS and Android.

## License

MIT
