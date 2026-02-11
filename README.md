# MostlyGoodMetrics Capacitor SDK

The official Capacitor SDK for [MostlyGoodMetrics](https://mostlygoodmetrics.com) analytics.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [User Identification](#user-identification)
- [Tracking Events](#tracking-events)
- [Event Naming](#event-naming)
- [Properties](#properties)
- [Manual Flush](#manual-flush)
- [Automatic Behavior](#automatic-behavior)
- [Automatic Events](#automatic-events)
- [Automatic Context](#automatic-context)
- [Automatic Properties](#automatic-properties)
- [Platform Support](#platform-support)
- [Super Properties](#super-properties)
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

The SDK requires several Capacitor plugins to function properly:

```bash
npm install @capacitor/core @capacitor/app @capacitor/device @capacitor/preferences
```

Then sync your native projects:

```bash
npx cap sync
```

**Dependency Details:**

| Plugin | Version | Required? | Purpose | Behavior if Missing |
|--------|---------|-----------|---------|---------------------|
| `@capacitor/core` | 5.0+ | ✅ Yes | Core Capacitor functionality | SDK will not work |
| `@capacitor/preferences` | 5.0+ | ⚠️ Recommended | Persistent event and user storage | Events stored in memory only (lost on app restart) |
| `@capacitor/app` | 5.0+ | ⚠️ Recommended | App lifecycle tracking (iOS/Android) | No lifecycle events (`$app_opened`, etc.) |
| `@capacitor/device` | 5.0+ | ⚠️ Recommended | Device info (model, manufacturer, OS) | Missing device properties in events |

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

The SDK automatically handles common tasks so you can focus on tracking what matters. No additional configuration is required for these features.

### Event Management

- **Event persistence** - Events are saved to Capacitor Preferences (via `@capacitor/preferences`) and survive app restarts
- **Fallback to memory** - If Preferences plugin is unavailable, events are stored in memory (lost on app restart, indicated by `$storage_type: "memory"` in event properties)
- **Batch processing** - Events are grouped into batches for efficient network usage (default: 100 events per batch, configurable via `maxBatchSize`)
- **Periodic flush** - Events are sent every 30 seconds (configurable via `flushInterval`)
- **Background flush** - Events are automatically flushed when the app goes to background (iOS/Android only, requires `@capacitor/app`)
- **Automatic flush on batch size** - Events flush immediately when the configured batch size is reached
- **Retry on failure** - Failed network requests are retried with exponential backoff; events are preserved until successfully sent
- **Rate limiting** - Exponential backoff when rate limited by the server (respects HTTP 429 responses)
- **Storage limits** - Defaults to 10,000 max stored events (configurable via `maxStoredEvents`); oldest events are dropped when limit is reached
- **Deduplication** - Each event includes a unique `clientEventId` to prevent duplicate processing on the server

### Lifecycle Tracking

When `trackAppLifecycleEvents` is enabled (default) and `@capacitor/app` is installed:

| Platform | App Lifecycle Events | Automatic Background Flush | Implementation Details |
|----------|---------------------|---------------------------|------------------------|
| **iOS** | ✅ Full Support | ✅ Yes | Uses `@capacitor/app` `appStateChange` listener<br>• `$app_opened` when app comes to foreground (state: `active`)<br>• `$app_backgrounded` when app goes to background (state: `inactive`)<br>• Background flush triggered on `inactive` state |
| **Android** | ✅ Full Support | ✅ Yes | Uses `@capacitor/app` `appStateChange` listener<br>• `$app_opened` when app comes to foreground (state: `active`)<br>• `$app_backgrounded` when app goes to background (state: `inactive`)<br>• Background flush triggered on `inactive` state |
| **Web** | ⚠️ Limited | ❌ No | Limited to initial page load only<br>• `$app_opened` only on initial page load<br>• No background/foreground events (browser doesn't provide reliable lifecycle)<br>• Relies on periodic flush interval |

**Deduplication**: Lifecycle events that fire multiple times within 1 second are automatically deduplicated to prevent duplicate tracking. This handles edge cases where the OS may fire lifecycle events in rapid succession.

**Missing Plugin Behavior**: If `@capacitor/app` is not installed, no lifecycle events will be tracked, but the SDK will continue to function normally for manual event tracking.

### Install & Update Detection

When `appVersion` is configured and `trackAppLifecycleEvents` is enabled:

- **First launch after install**: Tracks `$app_installed` event with `$version` property set to the configured app version
- **First launch after version change**: Tracks `$app_updated` event with both `$version` (new version) and `$previous_version` (old version)
- **Version persistence**: App version is stored in Preferences to detect updates across app launches
- **No version configured**: If `appVersion` is not configured, install/update tracking is disabled

### User & Identity Management

- **Anonymous tracking** - Events are tracked anonymously by default (no `userId` in context) until `identify()` is called
- **User ID persistence** - User identity set via `identify()` is saved to Preferences and automatically restored on app restart
- **Profile data** - Email and name passed to `identify()` are sent to the server but not persisted locally (must be re-identified on each launch if needed)
- **Identity reset** - Calling `resetIdentity()` clears the user ID from both memory and Preferences; subsequent events will not include `userId`
- **Session management** - New session ID (UUID) is generated on each app launch and persisted for the entire session
- **Session isolation** - Previous session context is not restored—each app launch creates a fresh session

### Context Collection

- **Automatic context** - Every event automatically includes platform, OS version, device info, locale, timezone, app version, environment, etc. (see [Automatic Context](#automatic-context))
- **Device info collection** - Device model, manufacturer, and detailed OS version are collected via `@capacitor/device` at initialization (gracefully degrades if plugin is unavailable)
- **Super properties** - Set persistent properties that are automatically included with every event (see [Super Properties](#super-properties))
- **Dynamic timestamp** - Each event includes an ISO 8601 timestamp generated at the time `track()` is called

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

The SDK automatically includes these fields with every event to provide rich context. You don't need to manually add these fields.

### Identity & Session

| Field | Description | Example | Persistence |
|-------|-------------|---------|-------------|
| `userId` | Identified user ID (set via `identify()`) | `user_123` | Persisted in Preferences (survives app restarts) |
| `sessionId` | UUID generated per app launch | `abc123-def456-789012-ghijkl` | Regenerated on each app launch |
| `clientEventId` | Unique UUID for each event (deduplication) | `550e8400-e29b-41d4-a716-446655440000` | Generated per event |

### Device & Platform

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `platform` | Platform identifier | `ios`, `android`, `web` | Auto-detected via Capacitor |
| `osVersion` | Device OS version | `17.0` (iOS)<br>`14` (Android)<br>`macOS 14.3` (Web) | Auto-detected via `@capacitor/device` (defaults to `unknown` if unavailable) |
| `deviceModel` | Device model name | `iPhone 14`, `SM-G998B` | Auto-detected via `@capacitor/device` (iOS/Android only) |
| `deviceManufacturer` | Device manufacturer | `Apple`, `Samsung` | Auto-detected via `@capacitor/device` (iOS/Android only) |
| `locale` | User's locale | `en-US`, `fr-FR` | Auto-detected via browser/device environment |
| `timezone` | User's timezone | `America/New_York`, `Europe/London` | Auto-detected via browser/device environment |

### App & Environment

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `appVersion` | App version (if configured) | `1.2.0` | Configuration option |
| `environment` | Environment name | `production`, `staging`, `development` | Configuration option (default: `production`) |
| `sdk` | SDK identifier | `capacitor` | Hardcoded |
| `sdkVersion` | SDK version | `0.2.0` | Package version |

### Event Metadata

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `timestamp` | ISO 8601 event time | `2024-01-15T10:30:00.000Z` | Auto-generated when event is tracked |

**Notes:**
- All fields are automatically collected when the SDK initializes
- `deviceManufacturer`, `deviceModel`, and detailed `osVersion` are only available when `@capacitor/device` is installed
- `locale` and `timezone` are detected by the underlying JavaScript SDK from the browser/device environment
- `clientEventId` is unique per event and used for server-side deduplication

## Automatic Properties

The SDK automatically includes these properties with every event:

| Property | Description | Example | Platform Availability |
|----------|-------------|---------|----------------------|
| `$device_type` | Device form factor | `phone`, `tablet`, `desktop` | All |
| `$device_model` | Device model name | `iPhone 14`, `SM-G998B` | iOS, Android (requires `@capacitor/device`) |
| `$storage_type` | Event persistence method | `persistent`, `memory` | All |

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
