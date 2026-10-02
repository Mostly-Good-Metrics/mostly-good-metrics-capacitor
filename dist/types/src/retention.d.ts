/** Bounds retained analytics data before serializing or capturing host objects. */
export declare const MAX_RETAINED_BYTES: number;
export declare const MAX_VALUE_BYTES: number;
export declare function ownedSnapshot<T>(value: T): {
    value: T;
    bytes: number;
} | null;
//# sourceMappingURL=retention.d.ts.map