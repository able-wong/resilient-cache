/**
 * Configuration options for the ResilientCacheClient
 */
export interface CacheClientOptions {
  /** Redis/Valkey host */
  host: string;

  /** Redis/Valkey port */
  port: number;

  /** Redis/Valkey password (optional) */
  password?: string;

  /** Connection timeout in ms (default: 1000) */
  connectTimeout?: number;

  /** Command timeout in ms (default: 500) */
  commandTimeout?: number;

  /** Delay before reconnect attempt after failure in ms (default: 10000) */
  reconnectDelay?: number;

  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;

  /** Queue commands when disconnected (default: false) */
  enableOfflineQueue?: boolean;

  /**
   * Default error handling behavior (default: 'graceful')
   * - 'graceful': Return default values when cache unavailable
   * - 'throw': Throw CacheUnavailableError when cache unavailable
   */
  onError?: 'graceful' | 'throw';

  /**
   * Auto-connect on first command (default: true)
   * When true, connect() is called automatically when the first command is issued.
   * When false, you must call connect() explicitly before issuing commands.
   */
  autoConnect?: boolean;
}

/**
 * Per-call options to override client defaults
 */
export interface CallOptions {
  /** Override error handling for this call */
  onError?: 'graceful' | 'throw';
}

/**
 * Options for getOrSet method
 */
export interface GetOrSetOptions<T> extends CallOptions {
  /**
   * Optional validator to check if a cached value is still valid/fresh.
   * Called when a cached value is found.
   * Return false to treat the cached value as stale (will call factory and update cache).
   * Return true to use the cached value as-is.
   */
  isValid?: (value: T) => boolean | Promise<boolean>;
}

/**
 * Connection state of the cache client
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'cooldown'
  | 'failed';

/**
 * Current connection status information
 */
export interface ConnectionStatus {
  /** Current connection state */
  state: ConnectionState;

  /** Last error that occurred */
  lastError?: Error;

  /** Timestamp of last successful connection */
  lastConnectedAt?: Date;

  /** Timestamp of last connection failure */
  lastFailedAt?: Date;

  /** Number of reconnection attempts */
  reconnectAttempts: number;

  /** When the cooldown period ends (if in cooldown state) */
  cooldownEndsAt?: Date;

  /** Timestamp of last successful command execution */
  lastSuccessAt?: Date;
}

/**
 * Interface for cache client implementations
 * Used for dependency injection and testing
 */
export interface ICacheClient {
  /**
   * Connect to the cache server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the cache server
   */
  disconnect(): Promise<void>;

  /**
   * Get a value from cache
   * @param key - Cache key
   * @param defaultValue - Optional default value if key doesn't exist or cache unavailable
   * @param options - Per-call options
   */
  get<T>(
    key: string,
    defaultValue?: T,
    options?: CallOptions,
  ): Promise<T | null>;

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Time to live in seconds (optional)
   * @param options - Per-call options
   */
  set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean>;

  /**
   * Remove a key from cache
   * @param key - Cache key
   * @param options - Per-call options
   */
  remove(key: string, options?: CallOptions): Promise<boolean>;

  /**
   * Remove all keys matching a prefix
   * @param prefix - Key prefix to match
   * @param options - Per-call options
   * @returns Number of keys removed, or -1 if unavailable in graceful mode
   */
  removeByPrefix(prefix: string, options?: CallOptions): Promise<number>;

  /**
   * Check if the cache is ready to accept commands
   */
  isReady(): boolean;

  /**
   * Ping the cache server
   * @param options - Per-call options
   */
  ping(options?: CallOptions): Promise<boolean>;

  /**
   * Remove all keys (FLUSHDB)
   * @param options - Per-call options
   */
  removeAll(options?: CallOptions): Promise<boolean>;

  /**
   * Increment a numeric value
   * @param key - Cache key
   * @param amount - Amount to increment by (default: 1)
   * @param defaultValue - Value returned if cache unavailable in graceful mode
   * @param options - Per-call options
   */
  increment(
    key: string,
    amount?: number,
    defaultValue?: number,
    options?: CallOptions,
  ): Promise<number>;

  /**
   * Decrement a numeric value
   * @param key - Cache key
   * @param amount - Amount to decrement by (default: 1)
   * @param defaultValue - Value returned if cache unavailable in graceful mode
   * @param options - Per-call options
   */
  decrement(
    key: string,
    amount?: number,
    defaultValue?: number,
    options?: CallOptions,
  ): Promise<number>;

  /**
   * Decrement a key or initialize it if it doesn't exist (atomic operation)
   * Used for rate limiting
   * @param key - Cache key
   * @param defaultValue - Initial value if key doesn't exist
   * @param ttlSeconds - TTL for the key
   * @param options - Per-call options
   */
  decrementOrInit(
    key: string,
    defaultValue: number,
    ttlSeconds: number,
    options?: CallOptions,
  ): Promise<number>;

  /**
   * Get a value from cache, or set it using a factory function if not found
   * @param key - Cache key
   * @param factory - Async function to generate the value if cache miss
   * @param ttlSeconds - Time to live in seconds (optional)
   * @param options - Options including optional isValid validator
   * @returns The cached or newly generated value
   */
  getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
    options?: GetOrSetOptions<T>,
  ): Promise<T>;

  /**
   * Check if a key exists in cache
   * @param key - Cache key
   * @param options - Per-call options
   * @returns true if key exists, false otherwise (or if unavailable in graceful mode)
   */
  exists(key: string, options?: CallOptions): Promise<boolean>;

  /**
   * Get the remaining TTL of a key in seconds
   * @param key - Cache key
   * @param options - Per-call options
   * @returns TTL in seconds, -1 if no TTL set, -2 if key doesn't exist (or if unavailable in graceful mode)
   */
  ttl(key: string, options?: CallOptions): Promise<number>;

  /**
   * Set a value only if the key does not exist (SETNX)
   * Useful for distributed locks and deduplication
   *
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Time to live in seconds (optional but recommended for locks)
   * @param options - Per-call options
   * @returns true if key was set (didn't exist), false if key already exists
   *
   * @note In graceful mode (default), returns false both when key exists AND when cache is unavailable.
   * For mutex/lock patterns where you need to distinguish these cases, use { onError: 'throw' }.
   */
  setIfNotExists<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean>;

  /**
   * Get multiple values from cache in a single round trip (MGET)
   * @param keys - Array of cache keys
   * @param options - Per-call options
   * @returns Array of values in same order as keys, null for missing keys
   */
  getMany<T>(keys: string[], options?: CallOptions): Promise<(T | null)[]>;

  /**
   * Set multiple key-value pairs in cache (MSET)
   * @param entries - Array of { key, value } pairs
   * @param ttlSeconds - Time to live in seconds (optional, applies to all keys)
   * @param options - Per-call options
   * @returns true if all keys were set successfully
   */
  setMany<T>(
    entries: Array<{ key: string; value: T }>,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean>;

  /**
   * Update the TTL of an existing key without changing its value (EXPIRE)
   * @param key - Cache key
   * @param ttlSeconds - New time to live in seconds
   * @param options - Per-call options
   * @returns true if key exists and TTL was set, false if key doesn't exist
   */
  expire(
    key: string,
    ttlSeconds: number,
    options?: CallOptions,
  ): Promise<boolean>;
}

/**
 * Configuration for CacheKeyBuilder
 */
export interface CacheKeyConfig {
  /** Application name */
  app: string;

  /** Environment (e.g., 'production', 'staging') */
  env: string;
}
