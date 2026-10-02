"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeTimeoutError = exports.NATIVE_TIMEOUT_MS = void 0;
exports.withNativeDeadline = withNativeDeadline;
// Internal bound for unresponsive native plugin promises. Timing out does not
// cancel native I/O, so callers must quarantine writes rather than retry them.
exports.NATIVE_TIMEOUT_MS = 5000;
class NativeTimeoutError extends Error {
}
exports.NativeTimeoutError = NativeTimeoutError;
function withNativeDeadline(operation) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new NativeTimeoutError('Native SDK operation timed out')), exports.NATIVE_TIMEOUT_MS);
        timer.unref?.();
        try {
            Promise.resolve(operation()).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
        }
        catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}
