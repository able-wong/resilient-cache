import Redis from 'ioredis';
import type {
  CacheClientOptions,
  CallOptions,
  ConnectionState,
  ConnectionStatus,
  GetOrSetOptions,
  ICacheClient,
} from './types.js';
import { CacheUnavailableError, CacheTimeoutError } from './errors.js';

type StateChangeCallback = (status: ConnectionStatus) => void;
type ErrorCallback = (error: Error) => void;

/** Maximum allowed cache key length */
const MAX_KEY_LENGTH = 512;

/**
 * Lua script for atomic decrement-or-init operation
 * Used for rate limiting: decrements if key exists, otherwise initializes with default
 */
const DECREMENT_OR_INIT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  return redis.call('DECR', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return tonumber(ARGV[1])
end
`;

/**
 * Resilient Redis/Valkey cache client with graceful degradation
 *
 * Features:
 * - Fast failure detection with configurable timeouts
 * - Delayed reconnection with cooldown period
 * - Graceful degradation (returns defaults when unavailable)
 * - Per-call error handling override
 *
 * @example
 * ```typescript
 * const client = new ResilientCacheClient({
 *   host: 'localhost',
 *   port: 6379,
 *   onError: 'graceful', // Default - return null/false when unavailable
 * });
 *
 * await client.connect();
 *
 * // Graceful mode - returns null if unavailable
 * const value = await client.get('mykey');
 *
 * // Override to throw for specific calls
 * try {
 *   await client.get('mykey', null, { onError: 'throw' });
 * } catch (e) {
 *   if (e instanceof CacheUnavailableError) {
 *     console.log('Cache is down');
 *   }
 * }
 * ```
 */
export class ResilientCacheClient implements ICacheClient {
  private redis: Redis | null = null;
  private state: ConnectionState = 'disconnected';
  private lastError?: Error;
  private lastConnectedAt?: Date;
  private lastSuccessAt?: Date;
  private lastFailedAt?: Date;
  private reconnectAttempts = 0;
  private cooldownEndsAt?: Date;
  private connectPromise: Promise<void> | null = null;

  private readonly stateChangeCallbacks: StateChangeCallback[] = [];
  private readonly errorCallbacks: ErrorCallback[] = [];

  // Bound event handlers for cleanup
  private readonly boundErrorHandler = (error: Error) =>
    this.handleConnectionFailure(error);
  private readonly boundCloseHandler = () => {
    if (this.state === 'connected') {
      this.handleConnectionFailure(new Error('Connection closed'));
    }
  };
  private readonly boundEndHandler = () => {
    if (this.state !== 'disconnected') {
      this.setState('disconnected');
    }
  };

  private readonly options: {
    host: string;
    port: number;
    password: string | undefined;
    connectTimeout: number;
    commandTimeout: number;
    reconnectDelay: number;
    maxReconnectAttempts: number;
    enableOfflineQueue: boolean;
    onError: 'graceful' | 'throw';
    autoConnect: boolean;
  };

  constructor(options: CacheClientOptions) {
    this.options = {
      host: options.host,
      port: options.port,
      password: options.password,
      connectTimeout: options.connectTimeout ?? 1000,
      commandTimeout: options.commandTimeout ?? 500,
      reconnectDelay: options.reconnectDelay ?? 10000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      enableOfflineQueue: options.enableOfflineQueue ?? false,
      onError: options.onError ?? 'graceful',
      autoConnect: options.autoConnect ?? true,
    };
  }

  /**
   * Connect to Redis/Valkey
   */
  async connect(): Promise<void> {
    if (this.state === 'connected') {
      return;
    }

    // Deduplicate concurrent connection attempts
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Internal connect implementation
   */
  private async doConnect(): Promise<void> {
    // Clear any cooldown state
    this.clearCooldown();

    this.setState('connecting');

    try {
      this.redis = new Redis({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        connectTimeout: this.options.connectTimeout,
        commandTimeout: this.options.commandTimeout,
        enableOfflineQueue: this.options.enableOfflineQueue,
        retryStrategy: () => null, // Disable auto-reconnect
        lazyConnect: true,
        maxRetriesPerRequest: 0,
      });

      this.setupEventHandlers();

      await this.redis.connect();
      this.setState('connected');
      this.lastConnectedAt = new Date();
      this.lastSuccessAt = new Date();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.handleConnectionFailure(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis/Valkey
   */
  async disconnect(): Promise<void> {
    this.clearCooldown();

    if (this.redis) {
      try {
        // Remove event listeners to prevent memory leaks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emitter = this.redis as any;
        emitter.removeListener('error', this.boundErrorHandler);
        emitter.removeListener('close', this.boundCloseHandler);
        emitter.removeListener('end', this.boundEndHandler);
        this.redis.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      } finally {
        this.redis = null;
      }
    }

    this.setState('disconnected');
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return {
      state: this.state,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailedAt: this.lastFailedAt,
      reconnectAttempts: this.reconnectAttempts,
      cooldownEndsAt: this.cooldownEndsAt,
    };
  }

  /**
   * Check if the client is ready to accept commands
   */
  isReady(): boolean {
    return this.state === 'connected' && this.redis?.status === 'ready';
  }

  /**
   * Ping the cache server
   */
  async ping(options?: CallOptions): Promise<boolean> {
    return this.executeCommand('ping', false, options, async () => {
      await this.redis!.ping();
      return true;
    });
  }

  /**
   * Get a value from cache
   */
  async get<T>(
    key: string,
    defaultValue?: T,
    options?: CallOptions,
  ): Promise<T | null> {
    this.validateKey(key);
    return this.executeCommand(
      'get',
      defaultValue ?? null,
      options,
      async () => {
        const result = await this.redis!.get(key);
        if (result === null) {
          return defaultValue ?? null;
        }
        try {
          const parsed = JSON.parse(result);
          return this.sanitizeParsedValue(parsed) as T;
        } catch {
          // Return raw string value if not valid JSON
          return result as unknown as T;
        }
      },
    );
  }

  /**
   * Set a value in cache
   */
  async set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean> {
    this.validateKey(key);
    if (ttlSeconds !== undefined) {
      this.validateTtl(ttlSeconds);
    }
    return this.executeCommand('set', false, options, async () => {
      const serialized = this.serialize(value);
      if (ttlSeconds) {
        await this.redis!.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.redis!.set(key, serialized);
      }
      return true;
    });
  }

  /**
   * Remove a key from cache
   */
  async remove(key: string, options?: CallOptions): Promise<boolean> {
    this.validateKey(key);
    return this.executeCommand('remove', false, options, async () => {
      const result = await this.redis!.del(key);
      return result > 0;
    });
  }

  /**
   * Remove all keys matching a prefix using SCAN (non-blocking)
   */
  async removeByPrefix(prefix: string, options?: CallOptions): Promise<number> {
    return this.executeCommand('removeByPrefix', -1, options, async () => {
      // Normalize pattern: remove trailing :* if present, then add *
      const normalizedPrefix = prefix.replace(/:?\*$/, '');
      const pattern = `${normalizedPrefix}*`;

      let count = 0;
      let cursor = '0';

      do {
        const [nextCursor, keys] = await this.redis!.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          const deleted = await this.redis!.del(...keys);
          count += deleted;
        }
      } while (cursor !== '0');

      return count;
    });
  }

  /**
   * Remove all keys (FLUSHDB)
   */
  async removeAll(options?: CallOptions): Promise<boolean> {
    return this.executeCommand('removeAll', false, options, async () => {
      await this.redis!.flushdb();
      return true;
    });
  }

  /**
   * Increment a numeric value
   */
  async increment(
    key: string,
    amount: number = 1,
    defaultValue: number = 0,
    options?: CallOptions,
  ): Promise<number> {
    this.validateKey(key);
    this.validateNumber(amount, 'amount');
    return this.executeCommand('increment', defaultValue, options, async () => {
      const result = await this.redis!.incrby(key, amount);
      return result;
    });
  }

  /**
   * Decrement a numeric value
   */
  async decrement(
    key: string,
    amount: number = 1,
    defaultValue: number = 0,
    options?: CallOptions,
  ): Promise<number> {
    this.validateKey(key);
    this.validateNumber(amount, 'amount');
    return this.executeCommand('decrement', defaultValue, options, async () => {
      const result = await this.redis!.decrby(key, amount);
      return result;
    });
  }

  /**
   * Atomic decrement or initialize operation
   * Used for rate limiting - decrements if key exists, otherwise initializes with default
   */
  async decrementOrInit(
    key: string,
    defaultValue: number,
    ttlSeconds: number,
    options?: CallOptions,
  ): Promise<number> {
    this.validateKey(key);
    this.validateNumber(defaultValue, 'defaultValue');
    this.validateTtl(ttlSeconds);
    return this.executeCommand(
      'decrementOrInit',
      defaultValue,
      options,
      async () => {
        const result = await this.redis!.eval(
          DECREMENT_OR_INIT_SCRIPT,
          1,
          key,
          defaultValue.toString(),
          ttlSeconds.toString(),
        );
        return Number(result);
      },
    );
  }

  /**
   * Get a value from cache, or set it using a factory function if not found
   * Implements the cache-aside pattern with optional staleness validation
   *
   * @param key - Cache key
   * @param factory - Async function to generate the value if cache miss or stale
   * @param ttlSeconds - Time to live in seconds (optional)
   * @param options - Options including optional isValid validator
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
    options?: GetOrSetOptions<T>,
  ): Promise<T> {
    this.validateKey(key);
    if (ttlSeconds !== undefined) {
      this.validateTtl(ttlSeconds);
    }

    // Try to get from cache first (always graceful - cache failure = cache miss)
    const cached = await this.get<T>(key, undefined, { onError: 'graceful' });
    if (cached !== null) {
      // If validator provided, check if cached value is still valid
      if (options?.isValid) {
        const isValid = await options.isValid(cached);
        if (!isValid) {
          // Cached value is stale - fetch fresh value
          const value = await factory();
          await this.set(key, value, ttlSeconds, { onError: 'graceful' });
          return value;
        }
      }
      return cached;
    }

    // Cache miss or unavailable - call factory
    const value = await factory();

    // Try to cache the result (best effort, always graceful)
    await this.set(key, value, ttlSeconds, { onError: 'graceful' });

    return value;
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string, options?: CallOptions): Promise<boolean> {
    this.validateKey(key);
    return this.executeCommand('exists', false, options, async () => {
      const result = await this.redis!.exists(key);
      return result === 1;
    });
  }

  /**
   * Get the remaining TTL of a key in seconds
   * Returns -1 if key exists but has no TTL
   * Returns -2 if key doesn't exist (or cache unavailable in graceful mode)
   */
  async ttl(key: string, options?: CallOptions): Promise<number> {
    this.validateKey(key);
    return this.executeCommand('ttl', -2, options, async () => {
      const result = await this.redis!.ttl(key);
      return result;
    });
  }

  /**
   * Set a value only if the key does not exist (SETNX)
   * Useful for distributed locks and deduplication
   *
   * @note In graceful mode (default), returns false both when key exists AND when cache is unavailable.
   * For mutex/lock patterns where you need to distinguish these cases, use { onError: 'throw' }.
   */
  async setIfNotExists<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean> {
    this.validateKey(key);
    if (ttlSeconds !== undefined) {
      this.validateTtl(ttlSeconds);
    }
    return this.executeCommand('setIfNotExists', false, options, async () => {
      const serialized = this.serialize(value);
      let result: string | null;
      if (ttlSeconds) {
        result = await this.redis!.set(key, serialized, 'EX', ttlSeconds, 'NX');
      } else {
        result = await this.redis!.set(key, serialized, 'NX');
      }
      return result === 'OK';
    });
  }

  /**
   * Get multiple values from cache in a single round trip (MGET)
   *
   * @param keys - Array of cache keys
   * @param options - Per-call options
   * @returns Array of values in same order as keys, null for missing keys
   */
  async getMany<T>(
    keys: string[],
    options?: CallOptions,
  ): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }
    for (const key of keys) {
      this.validateKey(key);
    }
    const defaultValue = keys.map(() => null) as (T | null)[];
    return this.executeCommand('getMany', defaultValue, options, async () => {
      const results = await this.redis!.mget(...keys);
      return results.map((result) => {
        if (result === null) {
          return null;
        }
        try {
          const parsed = JSON.parse(result);
          return this.sanitizeParsedValue(parsed) as T;
        } catch {
          // Return raw string value if not valid JSON
          return result as unknown as T;
        }
      });
    });
  }

  /**
   * Set multiple key-value pairs in cache (MSET)
   * If ttlSeconds is provided, uses a pipeline to set EXPIRE on each key
   *
   * @param entries - Array of { key, value } pairs
   * @param ttlSeconds - Time to live in seconds (optional, applies to all keys)
   * @param options - Per-call options
   * @returns true if all keys were set successfully
   */
  async setMany<T>(
    entries: Array<{ key: string; value: T }>,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean> {
    if (entries.length === 0) {
      return true;
    }
    for (const entry of entries) {
      this.validateKey(entry.key);
    }
    if (ttlSeconds !== undefined) {
      this.validateTtl(ttlSeconds);
    }
    return this.executeCommand('setMany', false, options, async () => {
      // Build key-value pairs for MSET
      const args: string[] = [];
      for (const entry of entries) {
        args.push(entry.key, this.serialize(entry.value));
      }

      if (ttlSeconds) {
        // Use pipeline: MSET + EXPIRE for each key
        const pipeline = this.redis!.pipeline();
        pipeline.mset(...args);
        for (const entry of entries) {
          pipeline.expire(entry.key, ttlSeconds);
        }
        await pipeline.exec();
      } else {
        await this.redis!.mset(...args);
      }
      return true;
    });
  }

  /**
   * Update the TTL of an existing key without changing its value (EXPIRE)
   *
   * @param key - Cache key
   * @param ttlSeconds - New time to live in seconds
   * @param options - Per-call options
   * @returns true if key exists and TTL was set, false if key doesn't exist
   */
  async expire(
    key: string,
    ttlSeconds: number,
    options?: CallOptions,
  ): Promise<boolean> {
    this.validateKey(key);
    this.validateTtl(ttlSeconds);
    return this.executeCommand('expire', false, options, async () => {
      const result = await this.redis!.expire(key, ttlSeconds);
      return result === 1;
    });
  }

  /**
   * Register a callback for connection state changes
   */
  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Register a callback for errors
   */
  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Execute a command with timeout and error handling
   */
  private async executeCommand<T>(
    operation: string,
    defaultValue: T,
    options: CallOptions | undefined,
    command: () => Promise<T>,
  ): Promise<T> {
    const onError = options?.onError ?? this.options.onError;

    // Try to ensure connection (handles auto-connect)
    if (!this.canExecuteCommands()) {
      const connected = await this.ensureConnected();
      if (!connected) {
        if (onError === 'throw') {
          throw new CacheUnavailableError(
            `Cache is unavailable (state: ${this.state})`,
            this.lastError,
            operation,
          );
        }
        return defaultValue;
      }
    }

    const timeout = this.createTimeoutWithCleanup<T>(operation);
    try {
      // Wrap command with timeout
      const result = await Promise.race([command(), timeout.promise]);
      this.lastSuccessAt = new Date();
      return result as T;
    } catch (error) {
      this.handleCommandError(error as Error, operation);

      if (onError === 'throw') {
        if (error instanceof CacheTimeoutError) {
          throw error;
        }
        throw new CacheUnavailableError(
          `Cache operation '${operation}' failed`,
          error as Error,
          operation,
        );
      }
      return defaultValue;
    } finally {
      timeout.cleanup();
    }
  }

  /**
   * Ensure connection is established (for auto-connect feature)
   * Respects circuit breaker - fails fast during cooldown, reconnects after cooldown expires
   */
  private async ensureConnected(): Promise<boolean> {
    // Already connected and ready
    if (this.canExecuteCommands()) {
      return true;
    }

    // Auto-connect disabled - don't attempt connection
    if (!this.options.autoConnect) {
      return false;
    }

    // During cooldown - check if cooldown has expired
    if (this.state === 'cooldown') {
      if (this.cooldownEndsAt && Date.now() >= this.cooldownEndsAt.getTime()) {
        // Cooldown expired - attempt reconnect
        return this.attemptReconnect();
      }
      // Still in cooldown - fail fast (circuit breaker open)
      return false;
    }

    // In failed state - reset and retry
    if (this.state === 'failed') {
      this.reconnectAttempts = 0;
      return this.attemptReconnect();
    }

    // Disconnected - try to connect
    if (this.state === 'disconnected') {
      try {
        await this.connect();
        return this.canExecuteCommands();
      } catch {
        return false;
      }
    }

    // Connecting or reconnecting - fail fast, don't block
    // First request triggers connection, others get graceful defaults until connected
    if (this.state === 'connecting' || this.state === 'reconnecting') {
      return false;
    }

    return false;
  }

  /**
   * Check if commands can be executed
   */
  private canExecuteCommands(): boolean {
    // During cooldown, immediately return false
    if (this.state === 'cooldown') {
      return false;
    }

    // Only allow commands when connected
    return this.state === 'connected' && this.redis?.status === 'ready';
  }

  /**
   * Create a timeout promise with cleanup
   */
  private createTimeoutWithCleanup<T>(operation: string): {
    promise: Promise<T>;
    cleanup: () => void;
  } {
    let timeoutId: ReturnType<typeof setTimeout>;
    const promise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new CacheTimeoutError(operation, this.options.commandTimeout));
      }, this.options.commandTimeout);
    });
    return {
      promise,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  /**
   * Validate cache key
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new TypeError('Cache key must be a non-empty string');
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(
        `Cache key exceeds maximum length of ${MAX_KEY_LENGTH} characters`,
      );
    }
    if (key.includes('\n') || key.includes('\r')) {
      throw new Error('Cache key cannot contain newline characters');
    }
  }

  /**
   * Validate TTL value
   */
  private validateTtl(ttlSeconds: number): void {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new TypeError('ttlSeconds must be a positive integer');
    }
  }

  /**
   * Validate numeric value
   */
  private validateNumber(value: number, name: string): void {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number`);
    }
  }

  /**
   * Serialize a value for storage in Redis
   */
  private serialize<T>(value: T): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /**
   * Sanitize parsed JSON to prevent prototype pollution
   */
  private sanitizeParsedValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeParsedValue(item));
    }

    // Remove dangerous properties
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      sanitized[key] = this.sanitizeParsedValue(obj[key]);
    }
    return sanitized;
  }

  /**
   * Set up Redis event handlers
   */
  private setupEventHandlers(): void {
    if (!this.redis) return;

    this.redis.on('error', this.boundErrorHandler);
    this.redis.on('close', this.boundCloseHandler);
    this.redis.on('end', this.boundEndHandler);
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(error: Error): void {
    this.lastError = error;
    this.lastFailedAt = new Date();
    this.reconnectAttempts++;

    // Notify error callbacks
    for (const callback of this.errorCallbacks) {
      try {
        callback(error);
      } catch {
        // Ignore callback errors
      }
    }

    // Check if max reconnect attempts reached
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setState('failed');
      return;
    }

    // Enter cooldown state
    this.enterCooldown();
  }

  /**
   * Handle command error
   */
  private handleCommandError(error: Error, _operation: string): void {
    if (this.isConnectionError(error)) {
      this.handleConnectionFailure(error);
    }
  }

  /**
   * Check if an error is a connection-related error
   */
  private isConnectionError(error: Error): boolean {
    // Check error code first (more reliable for system errors)
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code) {
      const connectionErrorCodes = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTCONN',
        'ECONNRESET',
        'EPIPE',
        'EHOSTUNREACH',
        'ENETUNREACH',
      ];
      if (connectionErrorCodes.includes(errorWithCode.code)) {
        return true;
      }
    }

    // Fallback to message check for ioredis-specific errors
    return error.message.includes('Connection is closed');
  }

  /**
   * Enter cooldown state (command-driven, no timer)
   * Next command after cooldown expires will trigger reconnect
   */
  private enterCooldown(): void {
    this.setState('cooldown');
    this.cooldownEndsAt = new Date(Date.now() + this.options.reconnectDelay);
  }

  /**
   * Clear cooldown state
   */
  private clearCooldown(): void {
    this.cooldownEndsAt = undefined;
  }

  /**
   * Attempt to reconnect
   * @returns true if reconnection successful
   */
  private async attemptReconnect(): Promise<boolean> {
    this.setState('reconnecting');

    try {
      // Disconnect existing connection if any
      if (this.redis) {
        this.redis.disconnect();
        this.redis = null;
      }

      // Try to connect
      await this.connect();
      return this.canExecuteCommands();
    } catch {
      // Connection failed - handled in connect()
      return false;
    }
  }

  /**
   * Set connection state and notify callbacks
   */
  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;

    this.state = newState;

    const status = this.getStatus();
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(status);
      } catch {
        // Ignore callback errors
      }
    }
  }
}
