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
  });
});
