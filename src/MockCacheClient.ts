import type { ICacheClient, CallOptions } from './types.js';
import { CacheUnavailableError } from './errors.js';

interface StoredValue {
  value: unknown;
  expiresAt?: number;
}

interface MockCacheClientOptions {
  /** Simulate cache being unavailable */
  simulateFailure?: boolean;

  /** Default error handling behavior */
  onError?: 'graceful' | 'throw';
}

/**
 * In-memory mock implementation of ICacheClient for testing
 *
 * @example
 * ```typescript
 * const mockClient = new MockCacheClient();
 *
 * // Use in tests
 * await mockClient.set('key', 'value', 60);
 * const result = await mockClient.get('key');
 *
 * // Simulate failures
 * mockClient.setSimulateFailure(true);
 * await mockClient.get('key'); // Returns null in graceful mode
 * ```
 */
export class MockCacheClient implements ICacheClient {
  private store: Map<string, StoredValue> = new Map();
  private simulateFailure: boolean;
  private defaultOnError: 'graceful' | 'throw';

  constructor(options: MockCacheClientOptions = {}) {
    this.simulateFailure = options.simulateFailure ?? false;
    this.defaultOnError = options.onError ?? 'graceful';
  }

  /**
   * Set whether to simulate cache failures
   */
  setSimulateFailure(simulate: boolean): void {
    this.simulateFailure = simulate;
  }

  /**
   * Get the internal store (for test assertions)
   */
  getStore(): Map<string, StoredValue> {
    return this.store;
  }

  /**
   * Clear all stored values
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Check if a key has expired and remove it if so
   */
  private isExpired(key: string): boolean {
    const item = this.store.get(key);
    if (!item) return true;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Handle error based on options
   */
  private handleError<T>(
    operation: string,
    defaultValue: T,
    options?: CallOptions,
  ): T {
    const onError = options?.onError ?? this.defaultOnError;
    if (onError === 'throw') {
      throw new CacheUnavailableError(
        'Cache is unavailable (simulated failure)',
        undefined,
        operation,
      );
    }
    return defaultValue;
  }

  isReady(): boolean {
    return !this.simulateFailure;
  }

  async ping(options?: CallOptions): Promise<boolean> {
    if (this.simulateFailure) {
      return this.handleError('ping', false, options);
    }
    return true;
  }

  async get<T>(
    key: string,
    defaultValue?: T,
    options?: CallOptions,
  ): Promise<T | null> {
    if (this.simulateFailure) {
      return this.handleError('get', defaultValue ?? null, options);
    }

    if (this.isExpired(key)) {
      return defaultValue ?? null;
    }

    const item = this.store.get(key);
    return (item?.value as T) ?? defaultValue ?? null;
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    options?: CallOptions,
  ): Promise<boolean> {
    if (this.simulateFailure) {
      return this.handleError('set', false, options);
    }

    const storedValue: StoredValue = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    };
    this.store.set(key, storedValue);
    return true;
  }

  async remove(key: string, options?: CallOptions): Promise<boolean> {
    if (this.simulateFailure) {
      return this.handleError('remove', false, options);
    }

    return this.store.delete(key);
  }

  async removeByPrefix(prefix: string, options?: CallOptions): Promise<number> {
    if (this.simulateFailure) {
      return this.handleError('removeByPrefix', -1, options);
    }

    // Remove trailing :* if present (from toPattern())
    const normalizedPrefix = prefix.replace(/:?\*$/, '');

    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async removeAll(options?: CallOptions): Promise<boolean> {
    if (this.simulateFailure) {
      return this.handleError('removeAll', false, options);
    }

    this.store.clear();
    return true;
  }

  async increment(
    key: string,
    amount: number = 1,
    defaultValue: number = 0,
    options?: CallOptions,
  ): Promise<number> {
    if (this.simulateFailure) {
      return this.handleError('increment', defaultValue, options);
    }

    if (this.isExpired(key)) {
      this.store.set(key, { value: defaultValue + amount });
      return defaultValue + amount;
    }

    const item = this.store.get(key);
    const currentValue =
      typeof item?.value === 'number' ? item.value : defaultValue;
    const newValue = currentValue + amount;
    this.store.set(key, { ...item, value: newValue });
    return newValue;
  }

  async decrement(
    key: string,
    amount: number = 1,
    defaultValue: number = 0,
    options?: CallOptions,
  ): Promise<number> {
    return this.increment(key, -amount, defaultValue, options);
  }

  async decrementOrInit(
    key: string,
    defaultValue: number,
    ttlSeconds: number,
    options?: CallOptions,
  ): Promise<number> {
    if (this.simulateFailure) {
      return this.handleError('decrementOrInit', defaultValue, options);
    }

    if (this.isExpired(key)) {
      // Key doesn't exist - initialize with default value and TTL
      this.store.set(key, {
        value: defaultValue,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return defaultValue;
    }

    // Key exists - decrement
    const item = this.store.get(key)!;
    const currentValue =
      typeof item.value === 'number' ? item.value : defaultValue;
    const newValue = currentValue - 1;
    this.store.set(key, { ...item, value: newValue });
    return newValue;
  }
}
