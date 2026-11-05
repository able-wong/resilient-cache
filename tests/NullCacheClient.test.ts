import { describe, it, expect, vi } from 'vitest';
import { NullCacheClient } from '../src/NullCacheClient.js';
import type { ICacheClient } from '../src/types.js';

describe('NullCacheClient', () => {
  const client: ICacheClient = new NullCacheClient();
  const throwMode = { onError: 'throw' as const };

  describe('lifecycle', () => {
    it('connect and disconnect resolve without doing anything', async () => {
      await expect(client.connect()).resolves.toBeUndefined();
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it('is never ready', () => {
      expect(client.isReady()).toBe(false);
    });

    it('ping returns false', async () => {
      expect(await client.ping()).toBe(false);
    });
  });

  describe('reads always miss', () => {
    it('get returns null without a default', async () => {
      expect(await client.get('key')).toBeNull();
    });

    it('get returns the default value', async () => {
      expect(await client.get('key', 'fallback')).toBe('fallback');
    });

    it('getMany returns null for every key', async () => {
      expect(await client.getMany(['a', 'b', 'c'])).toEqual([null, null, null]);
    });

    it('exists returns false', async () => {
      expect(await client.exists('key')).toBe(false);
    });

    it('ttl returns -2 (key does not exist)', async () => {
      expect(await client.ttl('key')).toBe(-2);
    });
  });

  describe('writes always fail silently', () => {
    it('set returns false', async () => {
      expect(await client.set('key', 'value', 60)).toBe(false);
    });

    it('setMany returns false', async () => {
      expect(await client.setMany([{ key: 'a', value: 1 }], 60)).toBe(false);
    });

    it('setIfNotExists returns false', async () => {
      expect(await client.setIfNotExists('lock', 'owner', 30)).toBe(false);
    });

    it('expire returns false', async () => {
      expect(await client.expire('key', 60)).toBe(false);
    });

    it('remove returns false', async () => {
      expect(await client.remove('key')).toBe(false);
    });

    it('removeByPrefix returns 0', async () => {
      expect(await client.removeByPrefix('app:')).toBe(0);
    });

    it('removeAll returns false', async () => {
      expect(await client.removeAll()).toBe(false);
    });
  });

  describe('counters', () => {
    it('increment returns the default value, or 0', async () => {
      expect(await client.increment('key', 5, 10)).toBe(10);
      expect(await client.increment('key')).toBe(0);
    });

    it('decrement returns the default value, or 0', async () => {
      expect(await client.decrement('key', 5, 10)).toBe(10);
      expect(await client.decrement('key')).toBe(0);
    });

    it('decrementOrInit returns defaultValue so rate limiters fail open', async () => {
      expect(await client.decrementOrInit('ratelimit', 100, 60)).toBe(100);
    });
  });

  describe('getOrSet', () => {
    it('calls the factory every time', async () => {
      const factory = vi.fn().mockResolvedValue('fresh');

      expect(await client.getOrSet('key', factory, 60)).toBe('fresh');
      expect(await client.getOrSet('key', factory, 60)).toBe('fresh');
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('propagates errors thrown by the factory', async () => {
      const factory = vi.fn().mockRejectedValue(new Error('source down'));

      await expect(client.getOrSet('key', factory)).rejects.toThrow(
        'source down',
      );
    });
  });

  describe('never throws its own errors', () => {
    it('returns failure values even in throw mode', async () => {
      await expect(client.ping(throwMode)).resolves.toBe(false);
      await expect(client.get('key', undefined, throwMode)).resolves.toBeNull();
      await expect(client.set('key', 'v', 60, throwMode)).resolves.toBe(false);
      await expect(client.remove('key', throwMode)).resolves.toBe(false);
      await expect(client.removeByPrefix('p', throwMode)).resolves.toBe(0);
      await expect(client.removeAll(throwMode)).resolves.toBe(false);
      await expect(client.increment('key', 1, 0, throwMode)).resolves.toBe(0);
      await expect(client.decrement('key', 1, 0, throwMode)).resolves.toBe(0);
      await expect(
        client.decrementOrInit('key', 5, 60, throwMode),
      ).resolves.toBe(5);
      await expect(client.exists('key', throwMode)).resolves.toBe(false);
      await expect(client.ttl('key', throwMode)).resolves.toBe(-2);
      await expect(
        client.setIfNotExists('key', 'v', 60, throwMode),
      ).resolves.toBe(false);
      await expect(client.getMany(['a'], throwMode)).resolves.toEqual([null]);
      await expect(
        client.setMany([{ key: 'a', value: 1 }], 60, throwMode),
      ).resolves.toBe(false);
      await expect(client.expire('key', 60, throwMode)).resolves.toBe(false);
    });
  });
});
