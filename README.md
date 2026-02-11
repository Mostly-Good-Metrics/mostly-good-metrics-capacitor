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

The SDK handles many tasks automatically to provide a seamless analytics experience. You don't need to manually manage any of these features—they work out of the box.

### Identity Management

- **Anonymous tracking**: Events are tracked anonymously by default (no `userId` in context) until `identify()` is called
- **User ID persistence**: User identity set via `identify()` is saved to Capacitor Preferences and automatically restored on app restart
- **Profile data**: Email and name passed to `identify()` are sent to the server but not persisted locally (must be re-identified on each launch if needed)
- **Identity reset**: Calling `resetIdentity()` clears the user ID from both memory and Preferences; subsequent events will not include `userId`
- **Session management**: New session ID (UUID) is generated on each app launch and persisted for the entire session
- **Session isolation**: Previous session context is not restored—each app launch creates a fresh session with a new `sessionId`

### Event Storage & Delivery

- **Event persistence**: Events are saved to Capacitor Preferences (via `@capacitor/preferences`) and survive app restarts
- **Fallback to memory**: If Preferences plugin is unavailable, events are stored in memory only (lost on app restart, indicated by `$storage_type: "memory"` property)
- **Batch processing**: Events are grouped into batches for efficient network usage (default: 100 events per batch, configurable via `maxBatchSize`)
- **Periodic flush**: Events are automatically sent every 30 seconds (configurable via `flushInterval`)
- **Flush on batch size**: Events flush immediately when the configured `maxBatchSize` is reached
- **Background flush**: Events are automatically flushed when the app goes to background (iOS/Android only, requires `@capacitor/app`)
- **Retry on failure**: Failed network requests are retried with exponential backoff (2s, 4s, 8s, etc.); events are preserved until successfully sent
- **Rate limiting**: Automatic exponential backoff when rate limited by the server (respects HTTP 429 responses)
- **Storage limits**: Defaults to 10,000 max stored events (configurable via `maxStoredEvents`); oldest events are dropped when limit is reached
- **Deduplication**: Each event includes a unique `clientEventId` (UUID) to prevent duplicate processing on the server

### Lifecycle Tracking

When `trackAppLifecycleEvents` is enabled (default: `true`) and `@capacitor/app` is installed, the SDK automatically tracks app lifecycle events:

| Platform | App Lifecycle Events | Automatic Background Flush | Implementation Details |
|----------|---------------------|---------------------------|------------------------|
| **iOS** | ✅ Full Support | ✅ Yes | Uses `@capacitor/app` `appStateChange` listener<br>• `$app_opened` when app comes to foreground (`isActive: true`)<br>• `$app_backgrounded` when app goes to background (`isActive: false`)<br>• Background flush triggered on `isActive: false` state |
| **Android** | ✅ Full Support | ✅ Yes | Uses `@capacitor/app` `appStateChange` listener<br>• `$app_opened` when app comes to foreground (`isActive: true`)<br>• `$app_backgrounded` when app goes to background (`isActive: false`)<br>• Background flush triggered on `isActive: false` state |
| **Web** | ⚠️ Limited | ❌ No | Limited to initial page load only<br>• `$app_opened` only on initial page load<br>• No background/foreground events (browser tabs don't provide reliable lifecycle APIs)<br>• Relies on periodic flush interval (`flushInterval`) |

**Deduplication**: Lifecycle events that fire multiple times within 1 second are automatically deduplicated to prevent duplicate tracking. This handles edge cases where the OS may fire lifecycle events in rapid succession during state transitions.

**Missing Plugin Behavior**: If `@capacitor/app` is not installed:
- No lifecycle events (`$app_opened`, `$app_backgrounded`) will be tracked
- No automatic background flush (events flush only on periodic interval or manual `flush()`)
- SDK continues to function normally for manual event tracking
- On Web platform, `$app_opened` still fires once on initial page load

#### iOS & Android Lifecycle Details

Both platforms use the same `@capacitor/app` plugin which provides a unified `appStateChange` event:

```typescript
App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) {
    // App came to foreground
    track('$app_opened');
  } else {
    // App went to background
    track('$app_backgrounded');
    flush(); // Ensure events are sent before app suspension
  }
});
```

**When events fire:**
- **iOS**: `isActive: false` when app enters background (user presses home, switches apps, or locks screen); `isActive: true` when app returns to foreground
- **Android**: `isActive: false` when app enters background (user presses home, switches apps); `isActive: true` when app returns to foreground
- **Edge case handling**: The 1-second deduplication window prevents duplicate events if the OS fires multiple rapid state changes

#### Web Lifecycle Details

Web browsers don't provide reliable page visibility or lifecycle APIs that match mobile app semantics. Therefore:

- `$app_opened` fires **only once** on initial page load (when SDK is configured)
- No subsequent lifecycle events fire when user switches tabs, minimizes browser, etc.
- Events are flushed on periodic interval only (no background flush trigger)
- Consider using the Page Visibility API manually if you need tab focus tracking

### Install & Update Detection

When `appVersion` is configured and `trackAppLifecycleEvents` is enabled (both are defaults), the SDK automatically detects app installs and updates:

#### Install Detection
- **Event**: `$app_installed`
- **When**: First launch after install (determined by absence of stored app version in Preferences)
- **Properties**: `$version` (current app version from configuration)
- **Requires**: `appVersion` configuration option

#### Update Detection
- **Event**: `$app_updated`
- **When**: First launch after version change (compares stored version with current `appVersion` config)
- **Properties**:
  - `$version` (new app version from configuration)
  - `$previous_version` (old app version from Preferences)
- **Requires**: `appVersion` configuration option

#### How It Works
1. On first launch, no version is stored in Preferences → `$app_installed` fires, version is saved
2. On subsequent launches, stored version is compared with `appVersion` config:
   - If versions match → no event
   - If versions differ → `$app_updated` fires, new version is saved
3. If `appVersion` is not configured, install/update tracking is completely disabled

**Best Practice**: Always set `appVersion` in your configuration to enable install/update tracking:
```typescript
MostlyGoodMetrics.configure('mgm_proj_your_api_key', {
  appVersion: '1.0.0', // From your build system or package.json
});
```

### Context Collection

- **Automatic context**: Every event automatically includes platform, OS version, device info, locale, timezone, app version, environment, and more (see [Automatic Context](#automatic-context))
- **Device info collection**: Device model, manufacturer, and detailed OS version are collected via `@capacitor/device` at initialization time (gracefully degrades if plugin is unavailable)
- **Super properties**: Set persistent properties that are automatically included with every event (see [Super Properties](#super-properties))
- **Dynamic timestamps**: Each event includes an ISO 8601 timestamp generated at the time `track()` is called (not when the event is sent)

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

Every event automatically includes the following context fields to provide rich analytics capabilities. These fields are collected automatically—you don't need to manually add any of them.

### Identity & Session

| Field | Description | Example | Persistence |
|-------|-------------|---------|-------------|
| `userId` | Identified user ID (set via `identify()`) | `user_123` | Persisted in Preferences (survives app restarts) |
| `sessionId` | UUID generated per app launch | `abc123-def456-789012-ghijkl` | Regenerated on each app launch |
| `clientEventId` | Unique UUID for each event (deduplication) | `550e8400-e29b-41d4-a716-446655440000` | Generated per event |

### Device & Platform

| Field | Description | Example | Platform Availability | Source |
|-------|-------------|---------|----------------------|--------|
| `platform` | Platform identifier | `ios`, `android`, `web` | All | `Capacitor.getPlatform()` |
| `osVersion` | Device OS version | `17.2` (iOS)<br>`14` (Android API level)<br>`macOS 14.3` (Web) | All | `@capacitor/device` plugin<br>(defaults to `"unknown"` if unavailable) |
| `deviceModel` | Device model name | `iPhone15,2`, `SM-G998B`, `Pixel 8` | iOS, Android only | `@capacitor/device` plugin<br>(not available on Web) |
| `deviceManufacturer` | Device manufacturer | `Apple`, `Samsung`, `Google` | iOS, Android only | `@capacitor/device` plugin<br>(iOS always returns `"Apple"`) |
| `locale` | User's locale/language setting | `en-US`, `fr-FR`, `ja-JP` | All | JavaScript `Intl.DateTimeFormat().resolvedOptions().locale`<br>(from browser/device environment) |
| `timezone` | User's timezone | `America/New_York`, `Europe/London`, `Asia/Tokyo` | All | JavaScript `Intl.DateTimeFormat().resolvedOptions().timeZone`<br>(from browser/device environment) |

### App & Environment

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `appVersion` | App version (if configured) | `1.2.0`, `2.5.1` | Configuration option (recommended to set for install/update tracking) |
| `environment` | Environment name | `production`, `staging`, `development` | Configuration option (default: `production`) |
| `sdk` | SDK identifier | `capacitor` | Hardcoded by SDK |
| `sdkVersion` | SDK version | `0.2.0` | Package version (from `package.json`) |

### Event Metadata

| Field | Description | Example | Purpose |
|-------|-------------|---------|---------|
| `timestamp` | ISO 8601 timestamp when event was tracked | `2024-01-15T10:30:00.000Z` | Event ordering and time-based analysis |

**Implementation Notes:**
- All context fields are automatically collected during SDK initialization
- Device info (`deviceManufacturer`, `deviceModel`, `osVersion`) is loaded asynchronously via `@capacitor/device` on startup
- If `@capacitor/device` is not installed:
  - `osVersion` defaults to `"unknown"`
  - `deviceModel` and `deviceManufacturer` are not included (iOS/Android only fields)
  - SDK continues to function normally with reduced context
- `locale` and `timezone` are collected by the underlying JavaScript SDK from the browser/device environment
- `clientEventId` is unique per event and used for server-side deduplication
- `sessionId` is regenerated on each app launch; previous session context is not restored

## Automatic Properties

The SDK automatically includes these properties with every event:

| Property | Description | Example | Platform Availability |
|----------|-------------|---------|----------------------|
| `$device_type` | Device form factor | `phone`, `tablet`, `desktop` | All |
| `$device_model` | Device model name | `iPhone 14`, `SM-G998B` | iOS, Android (requires `@capacitor/device`) |
| `$storage_type` | Event persistence method | `persistent`, `memory` | All |

## Platform Support

The SDK provides comprehensive cross-platform support with platform-specific optimizations. Features and data availability vary by platform based on underlying OS capabilities.

### Feature Support Matrix

| Feature | iOS | Android | Web |
|---------|-----|---------|-----|
| **Lifecycle Tracking** | ✅ Full support | ✅ Full support | ⚠️ Limited (initial load only) |
| **Background Flush** | ✅ Automatic on background | ✅ Automatic on background | ❌ Not applicable |
| **Persistent Storage** | ✅ Capacitor Preferences | ✅ Capacitor Preferences | ✅ localStorage (via Preferences) |
| **Install Detection** | ✅ `$app_installed` event | ✅ `$app_installed` event | ✅ `$app_installed` event |
| **Update Detection** | ✅ `$app_updated` event | ✅ `$app_updated` event | ✅ `$app_updated` event |
| **Device Model** | ✅ Hardware identifier | ✅ Build.MODEL | ❌ Not available |
| **Device Manufacturer** | ✅ Always "Apple" | ✅ Build.MANUFACTURER | ❌ Not available |
| **Device Type Detection** | ✅ Phone/Tablet (isPad) | ✅ Phone/Tablet | ⚠️ Desktop/Mobile (user agent) |
| **OS Version** | ✅ Semantic (e.g., "17.2") | ✅ API level (e.g., "14") | ⚠️ User agent parsing |

### Context Properties by Platform

This table shows which automatic context fields and properties are available on each platform:

| Property/Field | iOS | Android | Web | Notes |
|----------------|-----|---------|-----|-------|
| **Identity & Session** |
| `userId` | ✅ | ✅ | ✅ | Set via `identify()`, persisted in Preferences |
| `sessionId` | ✅ | ✅ | ✅ | UUID generated per app launch |
| `clientEventId` | ✅ | ✅ | ✅ | UUID per event for deduplication |
| **Platform & Device** |
| `platform` | ✅ `"ios"` | ✅ `"android"` | ✅ `"web"` | From `Capacitor.getPlatform()` |
| `osVersion` | ✅ `"17.2"` | ✅ `"14"` | ✅ `"macOS 14.3"` | From `@capacitor/device` (or "unknown") |
| `deviceModel` | ✅ `"iPhone15,2"` | ✅ `"Pixel 8"` | ❌ | From `@capacitor/device` (mobile only) |
| `deviceManufacturer` | ✅ `"Apple"` | ✅ `"Samsung"` | ❌ | From `@capacitor/device` (mobile only) |
| `locale` | ✅ | ✅ | ✅ | From JavaScript `Intl` API |
| `timezone` | ✅ | ✅ | ✅ | From JavaScript `Intl` API |
| **App & Environment** |
| `appVersion` | ✅ | ✅ | ✅ | From configuration (if set) |
| `environment` | ✅ | ✅ | ✅ | From configuration (default: "production") |
| `sdk` | ✅ `"capacitor"` | ✅ `"capacitor"` | ✅ `"capacitor"` | Hardcoded SDK identifier |
| `sdkVersion` | ✅ | ✅ | ✅ | Package version |
| **Automatic Properties** |
| `$device_type` | ✅ `"phone"/"tablet"` | ✅ `"phone"/"tablet"` | ✅ `"desktop"/"mobile"` | iOS uses `Platform.isPad`; Web uses user agent |
| `$device_model` | ✅ | ✅ | ❌ | Only on mobile when `@capacitor/device` installed |
| `$storage_type` | ✅ `"persistent"/"memory"` | ✅ `"persistent"/"memory"` | ✅ `"persistent"/"memory"` | Indicates if Preferences is available |

### Platform-Specific Implementation Details

#### iOS

**Lifecycle Events:**
- Uses `@capacitor/app` plugin's `appStateChange` listener
- `$app_opened`: Fires when app returns to foreground (`isActive: true`)
- `$app_backgrounded`: Fires when app enters background (`isActive: false`)
- Automatic flush triggered when app backgrounds

**Device Information:**
- `deviceModel`: Hardware identifier (e.g., "iPhone15,2" for iPhone 14 Pro)
- `deviceManufacturer`: Always "Apple"
- `osVersion`: Semantic version (e.g., "17.2", "16.4.1")
- `$device_type`: Accurately detects "phone" vs "tablet" using native APIs

**Storage:**
- Events persisted via `@capacitor/preferences` (maps to iOS UserDefaults)
- User ID persisted across app launches
- Falls back to in-memory storage if Preferences unavailable

#### Android

**Lifecycle Events:**
- Uses `@capacitor/app` plugin's `appStateChange` listener
- `$app_opened`: Fires when app returns to foreground (`isActive: true`)
- `$app_backgrounded`: Fires when app enters background (`isActive: false`)
- Automatic flush triggered when app backgrounds

**Device Information:**
- `deviceModel`: Build.MODEL (e.g., "Pixel 8", "SM-G998B")
- `deviceManufacturer`: Build.MANUFACTURER (e.g., "Google", "Samsung")
- `osVersion`: Android API level as string (e.g., "14" for Android 14, "31" for Android 12)
- `$device_type`: Detects "phone" vs "tablet" (can be enhanced with screen dimensions)

**Storage:**
- Events persisted via `@capacitor/preferences` (maps to Android SharedPreferences)
- User ID persisted across app launches
- Falls back to in-memory storage if Preferences unavailable

#### Web

**Lifecycle Events:**
- **Limited support**: Only `$app_opened` on initial page load
- No background/foreground events (browsers don't provide reliable lifecycle APIs for tabs)
- No automatic background flush (events flush on periodic interval only)
- `@capacitor/app` plugin has no effect on Web platform

**Device Information:**
- `deviceModel`: Not available (Web browsers don't expose device model)
- `deviceManufacturer`: Not available
- `osVersion`: Extracted from user agent string (e.g., "macOS 14.3", "Windows 10")
- `$device_type`: Inferred from user agent ("desktop" or "mobile")

**Storage:**
- Events persisted via `localStorage` (wrapped by `@capacitor/preferences`)
- User ID persisted in localStorage
- Falls back to in-memory storage if localStorage is disabled/unavailable (e.g., private browsing mode)

**Browser Considerations:**
- Install/update detection works but is based on localStorage (cleared if user clears browsing data)
- Private browsing mode may disable localStorage, forcing memory-only storage
- No tab visibility tracking (consider implementing manually with Page Visibility API if needed)

### Dependency Requirements

| Plugin | iOS | Android | Web | Purpose |
|--------|-----|---------|-----|---------|
| `@capacitor/core` | ✅ Required | ✅ Required | ✅ Required | Core Capacitor functionality |
| `@capacitor/preferences` | ⚠️ Recommended | ⚠️ Recommended | ⚠️ Recommended | Persistent event storage and user ID |
| `@capacitor/app` | ⚠️ Recommended | ⚠️ Recommended | ⚠️ Optional | Lifecycle tracking (`$app_opened`, etc.) |
| `@capacitor/device` | ⚠️ Recommended | ⚠️ Recommended | ⚠️ Recommended | Device info (model, manufacturer, OS version) |

**Note:** While only `@capacitor/core` is strictly required, we strongly recommend installing all plugins for full functionality. See [Installation](#installation) for details.

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
