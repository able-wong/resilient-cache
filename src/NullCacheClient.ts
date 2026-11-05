import type { ICacheClient, CallOptions, GetOrSetOptions } from './types.js';

/**
 * No-op cache client for when no cache is configured.
 *
 * Every read is a miss and every write is a silent failure, so services can
 * take an `ICacheClient` without null checks and simply run uncached.
 *
 * - `get()` returns the default value (or `null`)
 * - `getOrSet()` calls `factory()` every time
 * - writes and deletes return their failure values (`false`, `0`)
 *
 * Return values match what `ResilientCacheClient` returns in graceful mode
 * when the cache is unavailable.
 *
 * "Never throws" means it never throws errors of its own, even with
 * `{ onError: 'throw' }`: there is no cache to be unavailable. An error thrown
 * by the `factory` passed to `getOrSet()` still propagates to the caller.
 *
 * Usable on both client and server (no I/O).
 *
 * @example
 * ```typescript
 * const cache: ICacheClient = process.env.VALKEY_HOST
 *   ? new ResilientCacheClient({ host: process.env.VALKEY_HOST, port: 6379 })
 *   : new NullCacheClient();
 * ```
 */
export class NullCacheClient implements ICacheClient {
  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  isReady(): boolean {
    return false;
  }

  async ping(_options?: CallOptions): Promise<boolean> {
    return false;
  }

  async get<T>(
    _key: string,
    defaultValue?: T,
    _options?: CallOptions,
  ): Promise<T | null> {
    return defaultValue ?? null;
  }

  async set<T>(
    _key: string,
    _value: T,
    _ttlSeconds?: number,
    _options?: CallOptions,
  ): Promise<boolean> {
    return false;
  }

  async remove(_key: string, _options?: CallOptions): Promise<boolean> {
    return false;
  }

  async removeByPrefix(
    _prefix: string,
    _options?: CallOptions,
  ): Promise<number> {
    return 0;
  }

  async removeAll(_options?: CallOptions): Promise<boolean> {
    return false;
  }

  async increment(
    _key: string,
    _amount?: number,
    defaultValue?: number,
    _options?: CallOptions,
  ): Promise<number> {
    return defaultValue ?? 0;
  }

  async decrement(
    _key: string,
    _amount?: number,
    defaultValue?: number,
    _options?: CallOptions,
  ): Promise<number> {
    return defaultValue ?? 0;
  }

  /**
   * Returns `defaultValue`, not 0. Rate limiters built on decrementOrInit
   * treat 0 as "limit reached"; returning the initial allowance keeps them
   * fail-open, matching ResilientCacheClient when the cache is down.
   */
  async decrementOrInit(
    _key: string,
    defaultValue: number,
    _ttlSeconds: number,
    _options?: CallOptions,
  ): Promise<number> {
    return defaultValue;
  }

  async getOrSet<T>(
    _key: string,
    factory: () => Promise<T>,
    _ttlSeconds?: number,
    _options?: GetOrSetOptions<T>,
  ): Promise<T> {
    return factory();
  }

  async exists(_key: string, _options?: CallOptions): Promise<boolean> {
    return false;
  }

  async ttl(_key: string, _options?: CallOptions): Promise<number> {
    return -2;
  }

  async setIfNotExists<T>(
    _key: string,
    _value: T,
    _ttlSeconds?: number,
    _options?: CallOptions,
  ): Promise<boolean> {
    return false;
  }

  async getMany<T>(
    keys: string[],
    _options?: CallOptions,
  ): Promise<(T | null)[]> {
    return keys.map(() => null);
  }

  async setMany<T>(
    _entries: Array<{ key: string; value: T }>,
    _ttlSeconds?: number,
    _options?: CallOptions,
  ): Promise<boolean> {
    return false;
  }

  async expire(
    _key: string,
    _ttlSeconds: number,
    _options?: CallOptions,
  ): Promise<boolean> {
    return false;
  }
}
