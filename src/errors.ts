// V8 stack trace capture interface
interface ErrorWithCaptureStackTrace {
  captureStackTrace?(targetObject: object, constructorOpt?: unknown): void;
}

/**
 * Base error class for cache unavailability
 * Thrown when cache operation fails and onError: 'throw' is set
 */
export class CacheUnavailableError extends Error {
  /** The underlying cause of the error */
  public override readonly cause?: Error;

  /** The operation that failed */
  public readonly operation?: string;

  constructor(message: string, cause?: Error, operation?: string) {
    super(message);
    this.name = 'CacheUnavailableError';
    this.cause = cause;
    this.operation = operation;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    const ErrorCtor = Error as unknown as ErrorWithCaptureStackTrace;
    if (typeof ErrorCtor.captureStackTrace === 'function') {
      ErrorCtor.captureStackTrace(this, CacheUnavailableError);
    }
  }
}

/**
 * Thrown when a cache command times out
 */
export class CacheTimeoutError extends CacheUnavailableError {
  /** The timeout duration in milliseconds */
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(
      `Cache operation '${operation}' timed out after ${timeoutMs}ms`,
      undefined,
      operation,
    );
    this.name = 'CacheTimeoutError';
    this.timeoutMs = timeoutMs;

    const ErrorCtor = Error as unknown as ErrorWithCaptureStackTrace;
    if (typeof ErrorCtor.captureStackTrace === 'function') {
      ErrorCtor.captureStackTrace(this, CacheTimeoutError);
    }
  }
}
