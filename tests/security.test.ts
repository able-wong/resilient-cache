/**
 * Security and input validation tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResilientCacheClient } from '../src/ResilientCacheClient.js';

// Mock ioredis
vi.mock('ioredis', () => {
  const mockRedisInstance = {
    status: 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    decrby: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(30),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  return {
    default: vi.fn(() => mockRedisInstance),
  };
});

describe('Security Tests', () => {
  let client: ResilientCacheClient;

  beforeEach(async () => {
    vi.useRealTimers();
    client = new ResilientCacheClient({
      host: 'localhost',
      port: 6379,
    });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    vi.clearAllMocks();
  });

  describe('prototype pollution prevention', () => {
    it('should sanitize __proto__ from parsed JSON', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '{"__proto__": {"polluted": true}, "name": "test"}',
      );

      const result = await client.get<{ name: string }>('key');

      // Should not have __proto__ in result
      expect(result).toEqual({ name: 'test' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).__proto__?.polluted).toBeUndefined();
      // Object.prototype should not be polluted
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('should sanitize constructor from parsed JSON', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '{"constructor": {"bad": true}, "name": "test"}',
      );

      const result = await client.get<{ name: string }>('key');

      expect(result).toEqual({ name: 'test' });
    });

    it('should sanitize prototype from parsed JSON', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '{"prototype": {"bad": true}, "name": "test"}',
      );

      const result = await client.get<{ name: string }>('key');

      expect(result).toEqual({ name: 'test' });
    });

    it('should sanitize nested dangerous properties', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '{"user": {"__proto__": {"admin": true}, "name": "john"}}',
      );

      const result = await client.get<{ user: { name: string } }>('key');

      expect(result).toEqual({ user: { name: 'john' } });
    });

    it('should handle arrays with dangerous properties', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '[{"__proto__": {"x": 1}, "a": 1}, {"b": 2}]',
      );

      const result = await client.get<Array<{ a?: number; b?: number }>>('key');

      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });
  });
});

describe('Input Validation Tests', () => {
  let client: ResilientCacheClient;

  beforeEach(async () => {
    vi.useRealTimers();
    client = new ResilientCacheClient({
      host: 'localhost',
      port: 6379,
    });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    vi.clearAllMocks();
  });

  describe('cache key validation', () => {
    it('should reject empty key', async () => {
      await expect(client.get('')).rejects.toThrow(
        'Cache key must be a non-empty string',
      );
    });

    it('should reject null key', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(client.get(null as any)).rejects.toThrow(
        'Cache key must be a non-empty string',
      );
    });

    it('should reject key exceeding max length', async () => {
      const longKey = 'a'.repeat(513);
      await expect(client.get(longKey)).rejects.toThrow(
        'Cache key exceeds maximum length of 512 characters',
      );
    });

    it('should reject key with newline characters', async () => {
      await expect(client.get('key\nwith\nnewlines')).rejects.toThrow(
        'Cache key cannot contain newline characters',
      );
    });

    it('should reject key with carriage return', async () => {
      await expect(client.get('key\rwith\rreturns')).rejects.toThrow(
        'Cache key cannot contain newline characters',
      );
    });

    it('should accept valid key at max length', async () => {
      const maxKey = 'a'.repeat(512);
      // Should not throw
      await expect(client.get(maxKey)).resolves.toBeNull();
    });
  });

  describe('TTL validation', () => {
    it('should reject zero TTL', async () => {
      await expect(client.set('key', 'value', 0)).rejects.toThrow(
        'ttlSeconds must be a positive integer',
      );
    });

    it('should reject negative TTL', async () => {
      await expect(client.set('key', 'value', -1)).rejects.toThrow(
        'ttlSeconds must be a positive integer',
      );
    });

    it('should reject non-integer TTL', async () => {
      await expect(client.set('key', 'value', 1.5)).rejects.toThrow(
        'ttlSeconds must be a positive integer',
      );
    });

    it('should accept positive integer TTL', async () => {
      await expect(client.set('key', 'value', 60)).resolves.toBe(true);
    });
  });

  describe('numeric value validation', () => {
    it('should reject Infinity for increment amount', async () => {
      await expect(client.increment('key', Infinity)).rejects.toThrow(
        'amount must be a finite number',
      );
    });

    it('should reject NaN for increment amount', async () => {
      await expect(client.increment('key', NaN)).rejects.toThrow(
        'amount must be a finite number',
      );
    });

    it('should reject Infinity for decrementOrInit defaultValue', async () => {
      await expect(client.decrementOrInit('key', Infinity, 60)).rejects.toThrow(
        'defaultValue must be a finite number',
      );
    });
  });
});

describe('Concurrent Connection Tests', () => {
  it('should deduplicate concurrent connect calls', async () => {
    vi.useRealTimers();
    const client = new ResilientCacheClient({
      host: 'localhost',
      port: 6379,
    });

    // Call connect multiple times concurrently
    const results = await Promise.all([
      client.connect(),
      client.connect(),
      client.connect(),
    ]);

    // All should resolve successfully
    expect(results).toHaveLength(3);
    expect(client.getStatus().state).toBe('connected');

    await client.disconnect();
  });
});
