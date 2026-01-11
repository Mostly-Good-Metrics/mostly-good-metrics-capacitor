import { type MGMConfiguration, type EventProperties, type UserProfile } from '@mostly-good-metrics/javascript';
export type { MGMConfiguration, EventProperties, UserProfile };
export interface CapacitorConfig extends Omit<MGMConfiguration, 'storage'> {
    /**
     * The app version string. Required for install/update tracking.
     */
    appVersion?: string;
}
/**
 * MostlyGoodMetrics Capacitor SDK
 */
declare const MostlyGoodMetrics: {
    /**
     * Configure the SDK with an API key and optional settings.
     */
    configure(apiKey: string, config?: Omit<CapacitorConfig, "apiKey">): void;
    /**
     * Track an event with optional properties.
     */
    track(name: string, properties?: EventProperties): void;
    /**
     * Identify a user with optional profile data.
     * @param userId - The user's unique identifier
     * @param profile - Optional profile data including email and name
     */
    identify(userId: string, profile?: UserProfile): void;
    /**
     * Get the assigned variant for an experiment.
     */
    getVariant(experimentName: string): string | null;
    /**
     * Clear the current user identity.
     */
    resetIdentity(): void;
    /**
     * Manually flush pending events to the server.
     */
    flush(): void;
    /**
     * Start a new session with a fresh session ID.
     */
    startNewSession(): void;
    /**
     * Clear all pending events without sending them.
     */
    clearPendingEvents(): void;
    /**
     * Get the number of pending events.
     */
    getPendingEventCount(): Promise<number>;
    /**
     * Set a single super property that will be included with every event.
     */
    setSuperProperty(key: string, value: EventProperties[string]): void;
    /**
     * Set multiple super properties at once.
     */
    setSuperProperties(properties: EventProperties): void;
    /**
     * Remove a single super property.
     */
    removeSuperProperty(key: string): void;
    /**
     * Clear all super properties.
     */
    clearSuperProperties(): void;
    /**
     * Get all current super properties.
     */
    getSuperProperties(): EventProperties;
    /**
     * Clean up resources. Call when unmounting the app.
     */
    destroy(): void;
};
export default MostlyGoodMetrics;
//# sourceMappingURL=index.d.ts.map