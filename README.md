# MostlyGoodMetrics Capacitor SDK

The official Capacitor SDK for [MostlyGoodMetrics](https://mostlygoodmetrics.com) analytics.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Platform Support](#platform-support)
- [Configuration Options](#configuration-options)
- [User Identification](#user-identification)
- [Tracking Events](#tracking-events)
  - [Event Naming](#event-naming)
  - [Event Properties](#event-properties)
- [Super Properties](#super-properties)
- [Automatic Events](#automatic-events)
- [Automatic Context](#automatic-context)
- [Automatic Behavior](#automatic-behavior)
- [Manual Flush](#manual-flush)
- [Debug Logging](#debug-logging)
- [License](#license)

## Requirements

- Capacitor 5.0+
- iOS 13+, Android 5.0+, or modern browser

## Installation

Install the SDK via npm:

```bash
npm install @mostly-good-metrics/capacitor
```

### Capacitor Peer Dependencies

The SDK requires several Capacitor plugins to function properly. Install all of them:

```bash
npm install @capacitor/core @capacitor/app @capacitor/device @capacitor/preferences
```

Then sync your native projects:

```bash
npx cap sync
```

**Dependency Details:**

| Plugin | Required? | Purpose | Behavior if Missing |
|--------|-----------|---------|---------------------|
| `@capacitor/core` | ✅ Yes | Core Capacitor functionality | SDK will not work |
| `@capacitor/preferences` | ⚠️ Recommended | Persistent event and user storage | Events stored in memory only (lost on app restart) |
| `@capacitor/app` | ⚠️ Recommended | App lifecycle tracking (iOS/Android) | No lifecycle events (`$app_opened`, etc.) |
| `@capacitor/device` | ⚠️ Recommended | Device info (model, manufacturer, OS) | Missing device properties in events |

**Note:** While only `@capacitor/core` is strictly required, we strongly recommend installing all plugins for full functionality.

## Quick Start

### 1. Initialize the SDK

Initialize once at app startup, typically in your main entry file:

```typescript
import MostlyGoodMetrics from '@mostly-good-metrics/capacitor';

MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: '1.0.0', // Required for install/update tracking
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

### 3. Identify Users (Optional)

```typescript
// Set user identity
MostlyGoodMetrics.identify('user_123');
```

That's it! Events are automatically batched and sent. See [User Identification](#user-identification) for more details.

## Platform Support

| Platform | Lifecycle Tracking | Persistent Storage | Device Info | Specific Properties Available |
|----------|-------------------|-------------------|-------------|------------------------------|
| **iOS** | Full | Yes (Preferences) | Yes | `$device_model`, `$device_type`, `deviceManufacturer`, `osVersion` |
| **Android** | Full | Yes (Preferences) | Yes | `$device_model`, `$device_type`, `deviceManufacturer`, `osVersion` |
| **Web** | Limited | Yes (localStorage) | Limited | `$device_type`, `osVersion` (from user agent) |

### Platform-Specific Details

**iOS and Android (Native)**
- Full app lifecycle tracking (`$app_opened`, `$app_backgrounded`, `$app_installed`, `$app_updated`)
- Auto-flush when app backgrounds
- Complete device information via `@capacitor/device` plugin
- Persistent storage via `@capacitor/preferences` plugin
- `$device_type` detects phone vs tablet accurately

**Web (Browser)**
- Only tracks `$app_opened` on initial load (no background/foreground events)
- No automatic background flush (relies on periodic flush interval)
- Limited device info: `$device_type` inferred from user agent, no model or manufacturer
- Persistent storage via `localStorage` (wrapped by Preferences plugin)
- `osVersion` extracted from user agent string

**Peer Dependency Requirements**
- `@capacitor/core` - Required for all platforms
- `@capacitor/app` - Required for lifecycle tracking (iOS/Android only, optional for Web)
- `@capacitor/device` - Required for device info (all platforms, degrades gracefully if missing)
- `@capacitor/preferences` - Required for persistent storage (all platforms, falls back to memory if missing)

## Configuration Options

For more control, pass a configuration object:

```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: '1.0.0',
  environment: 'production',
  maxBatchSize: 100,
  flushInterval: 30,
  maxStoredEvents: 10000,
  enableDebugLogging: false,
  trackAppLifecycleEvents: true,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appVersion` | `string` | - | App version string (required for install/update tracking) |
| `environment` | `string` | `"production"` | Environment name |
| `baseURL` | `string` | `https://mostlygoodmetrics.com` | API endpoint |
| `maxBatchSize` | `number` | `100` | Events per batch (1-1000) |
| `flushInterval` | `number` | `30` | Auto-flush interval in seconds |
| `maxStoredEvents` | `number` | `10000` | Max cached events |
| `enableDebugLogging` | `boolean` | `false` | Enable console output |
| `trackAppLifecycleEvents` | `boolean` | `true` | Auto-track lifecycle events |

## User Identification

The SDK provides methods to identify users and associate events with specific user accounts.

### Identifying Users

Use `identify()` to set the current user's identity:

```typescript
// Basic identification with user ID
MostlyGoodMetrics.identify('user_123');

// Identification with profile data (email and name)
MostlyGoodMetrics.identify('user_123', {
  email: 'user@example.com',
  name: 'Jane Doe',
});
```

**Parameters:**
- `userId` (required): Unique identifier for the user (string)
- `profile` (optional): Object containing:
  - `email`: User's email address (string, optional)
  - `name`: User's display name (string, optional)

### User ID Persistence

User IDs are automatically persisted across app launches:

- **Storage**: Saved to Capacitor Preferences when `identify()` is called
- **Restoration**: Automatically restored on app restart (before any events are sent)
- **Included in events**: All events after identification include `userId` in the batch context

### Resetting Identity

Call `resetIdentity()` when a user logs out or you want to clear the current user:

```typescript
MostlyGoodMetrics.resetIdentity();
```

This clears the user ID from both memory and persistent storage. Subsequent events will not include a `userId` until `identify()` is called again.

### Best Practices

- **Call on login**: Identify users immediately after successful authentication
- **Reset on logout**: Always call `resetIdentity()` when users log out
- **Anonymous tracking**: If you don't call `identify()`, events are tracked anonymously (no `userId` in context)
- **User ID format**: Use stable, unique identifiers (database IDs, UUIDs, etc.)—avoid using email addresses as IDs

## Tracking Events

Track custom events throughout your app using the `track()` method.

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

## Automatic Events

When `trackAppLifecycleEvents` is enabled (default), the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First launch after install | `$version` |
| `$app_updated` | First launch after version change | `$version`, `$previous_version` |
| `$app_opened` | App came to foreground | - |
| `$app_backgrounded` | App went to background | - |

## Automatic Context

The SDK automatically includes context properties with every event. These are added at the event level and in the batch context sent to the server.

### Event-Level Properties

| Property | Description | Platform Availability |
|----------|-------------|----------------------|
| `$device_type` | Device type (`phone`, `tablet`, `desktop`) | All |
| `$device_model` | Device model (e.g., "iPhone 14", "SM-G998B") | iOS, Android |
| `$storage_type` | Storage type (`persistent` or `memory`) | All |

### Batch Context Properties

These properties are sent with each batch and apply to all events in the batch:

| Property | Description | Source |
|----------|-------------|--------|
| `platform` | Platform OS (`ios`, `android`, `web`) | Auto-detected via Capacitor |
| `appVersion` | App version string | Configuration option |
| `osVersion` | OS version (e.g., "17.0", "14") | Auto-detected via Device plugin |
| `environment` | Environment name | Configuration (default: `"production"`) |
| `userId` | Current user identifier | Set via `identify()` |
| `sessionId` | Unique session ID per app launch | Auto-generated |
| `deviceManufacturer` | Device manufacturer (e.g., "Apple", "Samsung") | Auto-detected via Device plugin (iOS/Android) |
| `locale` | User's locale (e.g., "en-US") | Auto-detected from browser/device |
| `timezone` | User's timezone (e.g., "America/New_York") | Auto-detected from browser/device |

**Notes:**
- Properties marked as "Auto-detected" are gathered automatically when the SDK initializes
- `deviceManufacturer` is only available on iOS and Android (requires `@capacitor/device`)
- `osVersion` defaults to `"unknown"` if Device plugin is not available
- `locale` and `timezone` are auto-detected by the underlying JavaScript SDK

## Event Naming

Event names must:
- Start with a letter (or `$` for system events)
- Contain only alphanumeric characters and underscores
- Be 255 characters or less

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');
MostlyGoodMetrics.track('PurchaseCompleted');
MostlyGoodMetrics.track('step_1_completed');

// Invalid (will be ignored)
MostlyGoodMetrics.track('123_event');      // starts with number
MostlyGoodMetrics.track('event-name');     // contains hyphen
MostlyGoodMetrics.track('event name');     // contains space
```

**Note:** Event names starting with `$` are reserved for system events. User events should not use this prefix.

## Event Properties

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

## Super Properties

Super properties are automatically included with every event. Use them for context that applies across your entire session (e.g., user plan, A/B test group).

```typescript
// Set a single super property
MostlyGoodMetrics.setSuperProperty('plan', 'premium');

// Set multiple super properties
MostlyGoodMetrics.setSuperProperties({
  plan: 'premium',
  tier: 'gold',
  ab_group: 'variant_a',
});

// Get all current super properties
const props = MostlyGoodMetrics.getSuperProperties();

// Remove a single super property
MostlyGoodMetrics.removeSuperProperty('plan');

// Clear all super properties
MostlyGoodMetrics.clearSuperProperties();
```

Super properties are merged with event properties. If an event property has the same key as a super property, the event property takes precedence.

## Manual Flush

Events are automatically flushed periodically and when the app backgrounds. You can also trigger a manual flush:

```typescript
MostlyGoodMetrics.flush();
```

To check pending events:

```typescript
const count = await MostlyGoodMetrics.getPendingEventCount();
console.log(`${count} events pending`);
```

## Automatic Behavior

The SDK handles several operations automatically to provide a seamless analytics experience.

### Event Persistence and Batching

- **Persists events** to Capacitor Preferences (via `@capacitor/preferences`), ensuring events survive app restarts
- **Fallback to memory**: If Preferences plugin is unavailable, events are stored in memory (lost on app restart)
- **Batches events** for efficient network usage, sending multiple events in a single request
- **Storage limits**: Defaults to 10,000 max stored events (configurable via `maxStoredEvents`)

### Automatic Flushing

- **Periodic flush**: Automatically sends events every 30 seconds (configurable via `flushInterval`)
- **Background flush**: Immediately flushes pending events when the app goes to background (iOS/Android)
- **Manual flush**: Call `flush()` to send events immediately when needed

### Network and Error Handling

- **Retries on failure**: Network errors don't lose events—they're preserved and retried on the next flush
- **Rate limiting**: Respects server rate limits and backs off appropriately
- **Error callbacks**: Optional `onError` callback for monitoring network issues

### Lifecycle Tracking

The SDK tracks app lifecycle automatically on iOS and Android (requires `@capacitor/app`):

| Platform | Behavior |
|----------|----------|
| **iOS** | Tracks app foreground (`$app_opened`) and background (`$app_backgrounded`) transitions via `appStateChange` listener |
| **Android** | Same as iOS—full lifecycle tracking via Capacitor App plugin |
| **Web** | Limited tracking—only tracks initial `$app_opened` (no native app backgrounding events) |

**Deduplication**: Lifecycle events that fire multiple times within 1 second are automatically deduplicated to prevent duplicate tracking.

### User and Session Management

- **Persists user ID**: User identity set via `identify()` is saved to Preferences and restored on app restart
- **Session ID generation**: New session ID generated on each app launch
- **Session restoration**: Previous session context is not restored—each launch creates a fresh session

### Install and Update Tracking

When `appVersion` is configured and `trackAppLifecycleEvents` is enabled:

- **First launch**: Tracks `$app_installed` with `$version` property
- **Version change**: Tracks `$app_updated` with `$version` and `$previous_version` on first launch after app update
- **Version persistence**: App version is stored in Preferences to detect updates across launches

## Debug Logging

Enable debug logging to see SDK activity:

```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  enableDebugLogging: true,
});
```

Output example:
```
[MostlyGoodMetrics] Configuring with options: {...}
[MostlyGoodMetrics] Setting up lifecycle tracking
[MostlyGoodMetrics] Device info loaded: {model: "iPhone 14", ...}
[MostlyGoodMetrics] Tracking lifecycle event: $app_opened
[MostlyGoodMetrics] Flushing events
```

## License

MIT
