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
}

/**
 * Per-call options to override client defaults
 */
export interface CallOptions {
  /** Override error handling for this call */
  onError?: 'graceful' | 'throw';
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
