import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockCacheClient, WrongTypeError } from '../src/MockCacheClient.js';
import { CacheUnavailableError } from '../src/errors.js';

describe('MockCacheClient', () => {
  let client: MockCacheClient;

  beforeEach(() => {
    client = new MockCacheClient();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      expect(client.isReady()).toBe(true);
    });

    it('should respect simulateFailure option', () => {
      const failingClient = new MockCacheClient({ simulateFailure: true });
      expect(failingClient.isReady()).toBe(false);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', async () => {
      await client.set('key1', 'value1');
      const result = await client.get('key1');
      expect(result).toBe('value1');
    });

    it('should return default value for missing keys', async () => {
      const result = await client.get('missing', 'default');
      expect(result).toBe('default');
    });

    it('should return null for missing keys without default', async () => {
      const result = await client.get('missing');
      expect(result).toBeNull();
    });

    it('should handle complex objects', async () => {
      const obj = { name: 'test', count: 42, nested: { a: 1 } };
      await client.set('obj', obj);
      const result = await client.get('obj');
      expect(result).toEqual(obj);
    });

    it('should handle TTL expiration', async () => {
      vi.useFakeTimers();
      await client.set('expiring', 'value', 1); // 1 second TTL

      expect(await client.get('expiring')).toBe('value');

      vi.advanceTimersByTime(1500); // Advance past TTL

      expect(await client.get('expiring')).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove existing key', async () => {
      await client.set('key1', 'value1');
      const result = await client.remove('key1');
      expect(result).toBe(true);
      expect(await client.get('key1')).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const result = await client.remove('missing');
      expect(result).toBe(false);
    });
  });

  describe('removeByPrefix', () => {
    it('should remove all keys matching prefix', async () => {
      await client.set('prefix:key1', 'value1');
      await client.set('prefix:key2', 'value2');
      await client.set('other:key3', 'value3');

      const count = await client.removeByPrefix('prefix:');

      expect(count).toBe(2);
      expect(await client.get('prefix:key1')).toBeNull();
      expect(await client.get('prefix:key2')).toBeNull();
      expect(await client.get('other:key3')).toBe('value3');
    });

    it('should handle pattern with wildcard suffix', async () => {
      await client.set('app:prod:key1', 'value1');
      await client.set('app:prod:key2', 'value2');

      const count = await client.removeByPrefix('app:prod:*');

      expect(count).toBe(2);
    });
  });

  describe('removeAll', () => {
    it('should clear all keys', async () => {
      await client.set('key1', 'value1');
      await client.set('key2', 'value2');

      await client.removeAll();

      expect(client.getStore().size).toBe(0);
    });
  });

  describe('increment/decrement', () => {
    it('should increment value', async () => {
      await client.set('counter', 10);
      const result = await client.increment('counter');
      expect(result).toBe(11);
    });

    it('should increment by custom amount', async () => {
      await client.set('counter', 10);
      const result = await client.increment('counter', 5);
      expect(result).toBe(15);
    });

    it('should initialize missing key with amount (not defaultValue)', async () => {
      const result = await client.increment('missing', 5, 100);
      expect(result).toBe(5);
    });

    it('should decrement value', async () => {
      await client.set('counter', 10);
      const result = await client.decrement('counter');
      expect(result).toBe(9);
    });

    it('should throw WrongTypeError when incrementing non-numeric value', async () => {
      await client.set('string-key', 'not a number');
      await expect(client.increment('string-key')).rejects.toThrow(
        WrongTypeError,
      );
      await expect(client.increment('string-key')).rejects.toThrow(
        'WRONGTYPE Operation against a key holding the wrong kind of value (INCRBY)',
      );
    });

    it('should throw WrongTypeError when decrementing non-numeric value', async () => {
      await client.set('string-key', 'not a number');
      await expect(client.decrement('string-key')).rejects.toThrow(
        WrongTypeError,
      );
    });
  });

  describe('decrementOrInit', () => {
    it('should initialize missing key with default value', async () => {
      vi.useFakeTimers();
      const result = await client.decrementOrInit('ratelimit', 30, 60);
      expect(result).toBe(30);
    });

    it('should decrement existing key', async () => {
      vi.useFakeTimers();
      await client.decrementOrInit('ratelimit', 30, 60);
      const result = await client.decrementOrInit('ratelimit', 30, 60);
      expect(result).toBe(29);
    });

    it('should reinitialize after TTL expiration', async () => {
      vi.useFakeTimers();
      await client.decrementOrInit('ratelimit', 30, 1);

      vi.advanceTimersByTime(1500);

      const result = await client.decrementOrInit('ratelimit', 30, 1);
      expect(result).toBe(30);
    });

    it('should throw WrongTypeError when key holds non-numeric value', async () => {
      vi.useFakeTimers();
      await client.set('string-key', 'not a number', 60);
      await expect(
        client.decrementOrInit('string-key', 30, 60),
      ).rejects.toThrow(WrongTypeError);
      await expect(
        client.decrementOrInit('string-key', 30, 60),
      ).rejects.toThrow(
        'WRONGTYPE Operation against a key holding the wrong kind of value (DECR)',
      );
    });
  });

  describe('ping', () => {
    it('should return true when ready', async () => {
      expect(await client.ping()).toBe(true);
    });

    it('should return false when simulating failure', async () => {
      client.setSimulateFailure(true);
      expect(await client.ping()).toBe(false);
    });
  });

  describe('error handling - graceful mode (default)', () => {
    beforeEach(() => {
      client.setSimulateFailure(true);
    });

    it('should return default value for get', async () => {
      const result = await client.get('key', 'default');
      expect(result).toBe('default');
    });

    it('should return false for set', async () => {
      const result = await client.set('key', 'value');
      expect(result).toBe(false);
    });

    it('should return false for remove', async () => {
      const result = await client.remove('key');
      expect(result).toBe(false);
    });

    it('should return -1 for removeByPrefix', async () => {
      const result = await client.removeByPrefix('prefix:');
      expect(result).toBe(-1);
    });

    it('should return default for decrementOrInit', async () => {
      const result = await client.decrementOrInit('key', 30, 60);
      expect(result).toBe(30);
    });
  });

  describe('error handling - throw mode', () => {
    beforeEach(() => {
      client = new MockCacheClient({ onError: 'throw' });
      client.setSimulateFailure(true);
    });

    it('should throw CacheUnavailableError for get', async () => {
      await expect(client.get('key')).rejects.toThrow(CacheUnavailableError);
    });

    it('should throw CacheUnavailableError for set', async () => {
      await expect(client.set('key', 'value')).rejects.toThrow(
        CacheUnavailableError,
      );
    });

    it('should throw CacheUnavailableError for ping', async () => {
      await expect(client.ping()).rejects.toThrow(CacheUnavailableError);
    });
  });

  describe('per-call error handling override', () => {
    it('should throw when overriding graceful client', async () => {
      const gracefulClient = new MockCacheClient({ onError: 'graceful' });
      gracefulClient.setSimulateFailure(true);

      await expect(
        gracefulClient.get('key', null, { onError: 'throw' }),
      ).rejects.toThrow(CacheUnavailableError);
    });

    it('should be graceful when overriding throw client', async () => {
      const throwClient = new MockCacheClient({ onError: 'throw' });
      throwClient.setSimulateFailure(true);

      const result = await throwClient.get('key', 'default', {
        onError: 'graceful',
      });
      expect(result).toBe('default');
    });
  });

  describe('getStore', () => {
    it('should return internal store for test assertions', async () => {
      await client.set('key1', 'value1');
      const store = client.getStore();
      expect(store.has('key1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all stored values', async () => {
      await client.set('key1', 'value1');
      client.clear();
      expect(client.getStore().size).toBe(0);
    });
  });

  describe('connect/disconnect', () => {
    it('should have no-op connect method', async () => {
      await expect(client.connect()).resolves.toBeUndefined();
    });

    it('should have no-op disconnect method', async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await client.set('key', 'value');
      const result = await client.exists('key');
      expect(result).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const result = await client.exists('missing');
      expect(result).toBe(false);
    });

    it('should return false for expired key', async () => {
      vi.useFakeTimers();
      await client.set('key', 'value', 1);
      vi.advanceTimersByTime(1500);
      const result = await client.exists('key');
      expect(result).toBe(false);
    });

    it('should return false when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const result = await client.exists('key');
      expect(result).toBe(false);
    });

    it('should throw when simulating failure (throw mode)', async () => {
      const throwClient = new MockCacheClient({ onError: 'throw' });
      throwClient.setSimulateFailure(true);
      await expect(throwClient.exists('key')).rejects.toThrow(
        CacheUnavailableError,
      );
    });
  });

  describe('ttl', () => {
    it('should return TTL for key with expiry', async () => {
      vi.useFakeTimers();
      await client.set('key', 'value', 60);
      const result = await client.ttl('key');
      expect(result).toBe(60);
    });

    it('should return -1 for key without TTL', async () => {
      await client.set('key', 'value');
      const result = await client.ttl('key');
      expect(result).toBe(-1);
    });

    it('should return -2 for non-existent key', async () => {
      const result = await client.ttl('missing');
      expect(result).toBe(-2);
    });

    it('should return -2 for expired key', async () => {
      vi.useFakeTimers();
      await client.set('key', 'value', 1);
      vi.advanceTimersByTime(1500);
      const result = await client.ttl('key');
      expect(result).toBe(-2);
    });

    it('should return -2 when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const result = await client.ttl('key');
      expect(result).toBe(-2);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value on cache hit', async () => {
      await client.set('key', 'cached-value');
      const factory = vi.fn().mockResolvedValue('new-value');
      const result = await client.getOrSet('key', factory);
      expect(result).toBe('cached-value');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache on cache miss', async () => {
      const factory = vi.fn().mockResolvedValue('new-value');
      const result = await client.getOrSet('missing', factory);
      expect(result).toBe('new-value');
      expect(factory).toHaveBeenCalledOnce();
      expect(await client.get('missing')).toBe('new-value');
    });

    it('should respect TTL parameter', async () => {
      vi.useFakeTimers();
      const factory = vi.fn().mockResolvedValue('value');
      await client.getOrSet('key', factory, 60);
      const ttl = await client.ttl('key');
      expect(ttl).toBe(60);
    });

    it('should call factory when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const factory = vi.fn().mockResolvedValue('fallback-value');
      const result = await client.getOrSet('key', factory);
      expect(result).toBe('fallback-value');
      expect(factory).toHaveBeenCalledOnce();
    });

    it('should propagate factory exceptions', async () => {
      const factory = vi.fn().mockRejectedValue(new Error('Factory failed'));
      await expect(client.getOrSet('key', factory)).rejects.toThrow(
        'Factory failed',
      );
    });

    it('should use cached value when isValid returns true', async () => {
      await client.set('key', { version: 2, data: 'cached' });
      const factory = vi.fn().mockResolvedValue({ version: 3, data: 'new' });
      const isValid = vi.fn().mockReturnValue(true);

      const result = await client.getOrSet('key', factory, 60, { isValid });

      expect(result).toEqual({ version: 2, data: 'cached' });
      expect(isValid).toHaveBeenCalledWith({ version: 2, data: 'cached' });
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory when isValid returns false (stale)', async () => {
      await client.set('key', { version: 1, data: 'old' });
      const factory = vi.fn().mockResolvedValue({ version: 2, data: 'new' });
      const isValid = vi.fn().mockReturnValue(false);

      const result = await client.getOrSet('key', factory, 60, { isValid });

      expect(result).toEqual({ version: 2, data: 'new' });
      expect(isValid).toHaveBeenCalledWith({ version: 1, data: 'old' });
      expect(factory).toHaveBeenCalledOnce();
      // Verify cache was updated
      expect(await client.get('key')).toEqual({ version: 2, data: 'new' });
    });

    it('should support async isValid validator', async () => {
      await client.set('key', { version: 1 });
      const factory = vi.fn().mockResolvedValue({ version: 2 });
      const isValid = vi.fn().mockResolvedValue(false); // async validator

      const result = await client.getOrSet('key', factory, 60, { isValid });

      expect(result).toEqual({ version: 2 });
      expect(factory).toHaveBeenCalledOnce();
    });

    it('should not call isValid on cache miss', async () => {
      const factory = vi.fn().mockResolvedValue({ data: 'new' });
      const isValid = vi.fn().mockReturnValue(true);

      const result = await client.getOrSet('missing-key', factory, 60, {
        isValid,
      });

      expect(result).toEqual({ data: 'new' });
      expect(isValid).not.toHaveBeenCalled();
      expect(factory).toHaveBeenCalledOnce();
    });
  });

  describe('setIfNotExists', () => {
    it('should set value when key does not exist', async () => {
      const result = await client.setIfNotExists('new-key', 'value', 60);
      expect(result).toBe(true);
      expect(await client.get('new-key')).toBe('value');
    });

    it('should not set value when key already exists', async () => {
      await client.set('existing-key', 'original');
      const result = await client.setIfNotExists('existing-key', 'new-value');
      expect(result).toBe(false);
      expect(await client.get('existing-key')).toBe('original');
    });

    it('should set value when key has expired', async () => {
      vi.useFakeTimers();
      await client.set('expiring-key', 'old', 1);
      vi.advanceTimersByTime(2000);
      const result = await client.setIfNotExists('expiring-key', 'new');
      expect(result).toBe(true);
      expect(await client.get('expiring-key')).toBe('new');
    });

    it('should respect TTL parameter', async () => {
      vi.useFakeTimers();
      await client.setIfNotExists('key', 'value', 60);
      const ttl = await client.ttl('key');
      expect(ttl).toBe(60);
    });

    it('should return false when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const result = await client.setIfNotExists('key', 'value');
      expect(result).toBe(false);
    });

    it('should throw when simulating failure (throw mode)', async () => {
      client.setSimulateFailure(true);
      await expect(
        client.setIfNotExists('key', 'value', 60, { onError: 'throw' }),
      ).rejects.toThrow(CacheUnavailableError);
    });
  });

  describe('getMany', () => {
    it('should return values for multiple keys', async () => {
      await client.set('key1', 'value1');
      await client.set('key2', 'value2');
      await client.set('key3', 'value3');

      const result = await client.getMany(['key1', 'key2', 'key3']);
      expect(result).toEqual(['value1', 'value2', 'value3']);
    });

    it('should return null for missing keys', async () => {
      await client.set('key1', 'value1');

      const result = await client.getMany(['key1', 'missing', 'key1']);
      expect(result).toEqual(['value1', null, 'value1']);
    });

    it('should return empty array for empty keys', async () => {
      const result = await client.getMany([]);
      expect(result).toEqual([]);
    });

    it('should return null for expired keys', async () => {
      vi.useFakeTimers();
      await client.set('key1', 'value1', 1);
      await client.set('key2', 'value2', 60);
      vi.advanceTimersByTime(2000);

      const result = await client.getMany(['key1', 'key2']);
      expect(result).toEqual([null, 'value2']);
    });

    it('should return array of nulls when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const result = await client.getMany(['key1', 'key2', 'key3']);
      expect(result).toEqual([null, null, null]);
    });

    it('should throw when simulating failure (throw mode)', async () => {
      client.setSimulateFailure(true);
      await expect(
        client.getMany(['key1', 'key2'], { onError: 'throw' }),
      ).rejects.toThrow(CacheUnavailableError);
    });

    it('should handle object values', async () => {
      await client.set('key1', { name: 'Alice' });
      await client.set('key2', { name: 'Bob' });

      const result = await client.getMany<{ name: string }>(['key1', 'key2']);
      expect(result).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
    });
  });

  describe('setMany', () => {
    it('should set multiple key-value pairs', async () => {
      const result = await client.setMany([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);
      expect(result).toBe(true);
      expect(await client.get('key1')).toBe('value1');
      expect(await client.get('key2')).toBe('value2');
    });

    it('should return true for empty entries', async () => {
      const result = await client.setMany([]);
      expect(result).toBe(true);
    });

    it('should respect TTL parameter', async () => {
      vi.useFakeTimers();
      await client.setMany(
        [
          { key: 'key1', value: 'value1' },
          { key: 'key2', value: 'value2' },
        ],
        60,
      );

      expect(await client.ttl('key1')).toBe(60);
      expect(await client.ttl('key2')).toBe(60);
    });

    it('should return false when simulating failure (graceful mode)', async () => {
      client.setSimulateFailure(true);
      const result = await client.setMany([{ key: 'key1', value: 'value1' }]);
      expect(result).toBe(false);
    });

    it('should throw when simulating failure (throw mode)', async () => {
      client.setSimulateFailure(true);
      await expect(
        client.setMany([{ key: 'key1', value: 'value1' }], 60, {
          onError: 'throw',
        }),
      ).rejects.toThrow(CacheUnavailableError);
    });

    it('should handle object values', async () => {
      await client.setMany([
        { key: 'key1', value: { name: 'Alice' } },
        { key: 'key2', value: { name: 'Bob' } },
      ]);

      expect(await client.get('key1')).toEqual({ name: 'Alice' });
      expect(await client.get('key2')).toEqual({ name: 'Bob' });
    });
  });

  describe('expire', () => {
    it('should update TTL of existing key', async () => {
      vi.useFakeTimers();
      await client.set('key', 'value', 30);
      const result = await client.expire('key', 120);
      expect(result).toBe(true);
      expect(await client.ttl('key')).toBe(120);
    });

    it('should return false for non-existent key', async () => {
      const result = await client.expire('missing', 60);
      expect(result).toBe(false);
    });

    it('should return false for expired key', async () => {
      vi.useFakeTimers();
      await client.set('key', 'value', 1);
      vi.advanceTimersByTime(2000);
      const result = await client.expire('key', 60);
      expect(result).toBe(false);
    });

    it('should return false when simulating failure (graceful mode)', async () => {
      await client.set('key', 'value');
      client.setSimulateFailure(true);
      const result = await client.expire('key', 60);
      expect(result).toBe(false);
    });

    it('should throw when simulating failure (throw mode)', async () => {
      await client.set('key', 'value');
      client.setSimulateFailure(true);
      await expect(
        client.expire('key', 60, { onError: 'throw' }),
      ).rejects.toThrow(CacheUnavailableError);
    });
  });
});
