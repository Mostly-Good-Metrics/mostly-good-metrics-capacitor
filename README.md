# MostlyGoodMetrics Capacitor SDK

A lightweight Capacitor SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Requirements

- Capacitor 5.0+
- iOS 13.0+ / Android 5.0+ / Modern browsers

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

## Quick Start

### 1. Initialize the SDK

Initialize the SDK as early as possible in your app, typically in your main entry file:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/capacitor';

MostlyGoodMetrics.configure('your-api-key', {
  appVersion: '1.0.0',
  environment: 'production',
});
```

### 2. Track Events

```typescript
MostlyGoodMetrics.track('button_clicked', {
  button_name: 'signup',
  screen: 'home',
});
```

### 3. Identify Users

```typescript
MostlyGoodMetrics.identify('user-123');
```

That's it! Events are automatically batched and sent.

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | **(required)** | Your MostlyGoodMetrics API key |
| `baseUrl` | `https://mostlygoodmetrics.com` | Base URL for the analytics API |
| `appVersion` | - | App version string (required for install/update tracking) |
| `environment` | `"production"` | Environment name (e.g., "production", "staging") |
| `maxBatchSize` | `100` | Maximum events per batch (range: 1-1000) |
| `flushInterval` | `30` | Seconds between automatic flushes |
| `maxStoredEvents` | `10000` | Maximum events to store locally before dropping oldest |
| `enableDebugLogging` | `false` | Enable console logging for debugging |
| `trackAppLifecycleEvents` | `true` | Automatically track app lifecycle events |

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App came to foreground | - |
| `$app_backgrounded` | App went to background | - |

> **Note:** Install and update detection requires passing `appVersion` in the configuration.

## Automatic Context/Properties

The SDK automatically includes these properties with every event:

| Property | Description |
|----------|-------------|
| `$device_type` | Device type (`phone`, `tablet`, `desktop`) |
| `$device_model` | Device model (e.g., "iPhone14,2") |
| `$os_version` | Operating system version |
| `$platform` | Platform (`ios`, `android`, `web`) |
| `$session_id` | Unique session identifier |
| `$timestamp` | Event timestamp (ISO 8601) |
| `$environment` | Environment from configuration |

## Event Naming

Event names must follow these rules:

1. Must start with a letter (a-z, A-Z)
2. Can only contain letters, numbers, and underscores
3. Maximum 255 characters

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');     // lowercase with underscore
MostlyGoodMetrics.track('UserSignedUp');       // PascalCase
MostlyGoodMetrics.track('page_view_2');        // with numbers

// Invalid
MostlyGoodMetrics.track('123_event');          // starts with number
MostlyGoodMetrics.track('button-clicked');     // contains hyphen
MostlyGoodMetrics.track('event name');         // contains space
```

> **Note:** Event names starting with `$` are reserved for system events.

## Properties

Properties support the following types:

```typescript
MostlyGoodMetrics.track('purchase_completed', {
  // String
  product_name: 'Premium Plan',

  // Number (int or double)
  price: 99.99,
  quantity: 1,

  // Boolean
  is_first_purchase: true,

  // Null
  coupon_code: null,

  // Array
  tags: ['electronics', 'sale'],

  // Nested object
  user: {
    tier: 'gold',
    points: 1500,
  },
});
```

### Property Limits

- **String values**: Truncated to 1,000 characters
- **Nesting depth**: Maximum 3 levels
- **Total size**: Maximum 10KB per event

## User Identification

### identify()

Associate events with a specific user:

```typescript
// Basic identification
MostlyGoodMetrics.identify('user-123');

// With profile data
MostlyGoodMetrics.identify('user-123', {
  email: 'user@example.com',
  name: 'Jane Doe',
});
```

### resetIdentity()

Clear the current user identity (e.g., on logout):

```typescript
MostlyGoodMetrics.resetIdentity();
```

After calling `resetIdentity()`, subsequent events will not be associated with any user until `identify()` is called again.

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

Super properties are useful for values that remain constant across many events, such as user subscription tier or A/B test variants.

## Manual Flush

Force send pending events to the server:

```typescript
// Flush all pending events
MostlyGoodMetrics.flush();

// Check pending event count before flushing
const count = await MostlyGoodMetrics.getPendingEventCount();
console.log(`Pending events: ${count}`);

// Clear pending events without sending
MostlyGoodMetrics.clearPendingEvents();
```

## Automatic Behavior

The SDK automatically:

- **Persists** events to local storage using Capacitor Preferences
- **Batches** events for efficient network usage
- **Flushes** events every 30 seconds (configurable)
- **Flushes** events when the app goes to background
- **Retries** failed requests with exponential backoff
- **Handles** offline scenarios by queuing events
- **Generates** unique session IDs
- **Restores** user identity across app restarts

## Debug Logging

Enable debug logging to troubleshoot issues:

```typescript
MostlyGoodMetrics.configure('your-api-key', {
  enableDebugLogging: true,
});
```

Example output:

```
[MostlyGoodMetrics] Configuring with options: { enableDebugLogging: true }
[MostlyGoodMetrics] Device info loaded: { model: "iPhone14,2", osVersion: "17.0" }
[MostlyGoodMetrics] Setting up lifecycle tracking
[MostlyGoodMetrics] Tracking lifecycle event: $app_opened
[MostlyGoodMetrics] Flushing events
```

## Platform Support

- **iOS** - Full lifecycle tracking via Capacitor App plugin
- **Android** - Full lifecycle tracking via Capacitor App plugin
- **Web** - Basic support (limited lifecycle tracking)

## License

MIT
