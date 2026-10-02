export declare const NATIVE_TIMEOUT_MS = 5000;
export declare class NativeTimeoutError extends Error {
}
export declare function withNativeDeadline<T>(operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=native.d.ts.map