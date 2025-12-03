/**
 * Integration tests for ResilientCacheClient against real Redis/Valkey
 *
 * Prerequisites:
 *   docker run -d --name redis-test -p 6379:6379 redis:7-alpine
 *   # or for Valkey:
 *   docker run -d --name valkey-test -p 6379:6379 valkey/valkey:7-alpine
 *
 * Run:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ResilientCacheClient } from '../../src/ResilientCacheClient.js';
import { CacheKeyBuilder } from '../../src/CacheKeyBuilder.js';
import { CacheUnavailableError } from '../../src/errors.js';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

describe('ResilientCacheClient Integration Tests', () => {
  let client: ResilientCacheClient;
  const testPrefix = `test:${Date.now()}`;

  beforeAll(async () => {
    client = new ResilientCacheClient({
      host: REDIS_HOST,
      port: REDIS_PORT,
      connectTimeout: 5000,
      commandTimeout: 2000,
    });

    await client.connect();
  });

  afterAll(async () => {
    // Clean up test keys
    await client.removeByPrefix(testPrefix);
    await client.disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test
    await client.removeByPrefix(testPrefix);
  });

  describe('connection', () => {
    it('should be connected and ready', () => {
      expect(client.isReady()).toBe(true);
      expect(client.getStatus().state).toBe('connected');
    });

    it('should ping successfully', async () => {
      const result = await client.ping();
      expect(result).toBe(true);
    });
  });

  describe('basic operations', () => {
    it('should set and get a string value', async () => {
      const key = `${testPrefix}:string`;
      await client.set(key, 'hello');

      const result = await client.get<string>(key);
      expect(result).toBe('hello');
    });

    it('should set and get an object value', async () => {
      const key = `${testPrefix}:object`;
      const obj = { name: 'test', count: 42, nested: { a: 1 } };

      await client.set(key, obj);

      const result = await client.get<typeof obj>(key);
      expect(result).toEqual(obj);
    });

    it('should return null for non-existent key', async () => {
      const result = await client.get(`${testPrefix}:nonexistent`);
      expect(result).toBeNull();
    });

    it('should return default value for non-existent key', async () => {
      const result = await client.get(`${testPrefix}:nonexistent`, 'default');
      expect(result).toBe('default');
    });

    it('should respect TTL', async () => {
      const key = `${testPrefix}:ttl`;
      await client.set(key, 'expiring', 1); // 1 second TTL

      // Should exist immediately
      expect(await client.get(key)).toBe('expiring');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should be gone
      expect(await client.get(key)).toBeNull();
    });

    it('should remove a key', async () => {
      const key = `${testPrefix}:remove`;
      await client.set(key, 'value');

      const removed = await client.remove(key);
      expect(removed).toBe(true);

      const result = await client.get(key);
      expect(result).toBeNull();
    });

    it('should return false when removing non-existent key', async () => {
      const removed = await client.remove(`${testPrefix}:nonexistent`);
      expect(removed).toBe(false);
    });
  });

  describe('removeByPrefix', () => {
    it('should remove all keys with matching prefix', async () => {
      const prefix = `${testPrefix}:bulk`;

      // Create multiple keys
      await Promise.all([
        client.set(`${prefix}:1`, 'value1'),
        client.set(`${prefix}:2`, 'value2'),
        client.set(`${prefix}:3`, 'value3'),
        client.set(`${testPrefix}:other`, 'other'),
      ]);

      // Remove by prefix
      const count = await client.removeByPrefix(`${prefix}:`);
      expect(count).toBe(3);

      // Verify removed
      expect(await client.get(`${prefix}:1`)).toBeNull();
      expect(await client.get(`${prefix}:2`)).toBeNull();
      expect(await client.get(`${prefix}:3`)).toBeNull();

      // Other key should still exist
      expect(await client.get(`${testPrefix}:other`)).toBe('other');
    });

    it('should handle pattern with wildcard', async () => {
      const prefix = `${testPrefix}:wild`;

      await client.set(`${prefix}:a`, 'a');
      await client.set(`${prefix}:b`, 'b');

      const count = await client.removeByPrefix(`${prefix}:*`);
      expect(count).toBe(2);
    });
  });

  describe('increment/decrement', () => {
    it('should increment a value', async () => {
      const key = `${testPrefix}:incr`;

      const result1 = await client.increment(key);
      expect(result1).toBe(1);

      const result2 = await client.increment(key);
      expect(result2).toBe(2);

      const result3 = await client.increment(key, 5);
      expect(result3).toBe(7);
    });

    it('should decrement a value', async () => {
      const key = `${testPrefix}:decr`;
      await client.set(key, '10');

      const result = await client.decrement(key);
      expect(result).toBe(9);
    });
  });

  describe('decrementOrInit (rate limiting)', () => {
    it('should initialize with default value on first call', async () => {
      const key = `${testPrefix}:ratelimit:init`;

      const result = await client.decrementOrInit(key, 30, 60);
      expect(result).toBe(30);
    });

    it('should decrement on subsequent calls', async () => {
      const key = `${testPrefix}:ratelimit:decr`;

      const result1 = await client.decrementOrInit(key, 30, 60);
      expect(result1).toBe(30);

      const result2 = await client.decrementOrInit(key, 30, 60);
      expect(result2).toBe(29);

      const result3 = await client.decrementOrInit(key, 30, 60);
      expect(result3).toBe(28);
    });

    it('should reset after TTL expires', async () => {
      const key = `${testPrefix}:ratelimit:ttl`;

      // Initialize with 1 second TTL
      await client.decrementOrInit(key, 30, 1);
      await client.decrementOrInit(key, 30, 1); // Now 29

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should reinitialize
      const result = await client.decrementOrInit(key, 30, 1);
      expect(result).toBe(30);
    });

    it('should handle concurrent requests atomically', async () => {
      const key = `${testPrefix}:ratelimit:concurrent`;

      // Fire 10 concurrent requests
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => client.decrementOrInit(key, 30, 60)),
      );

      // One should be 30 (init), rest should be decrements
      // All values should be unique (no race condition)
      const sorted = [...results].sort((a, b) => b - a);
      expect(sorted[0]).toBe(30);
      expect(sorted[sorted.length - 1]).toBe(21);

      // Check uniqueness (no duplicates = atomic)
      const unique = new Set(results);
      expect(unique.size).toBe(10);
    });
  });

  describe('CacheKeyBuilder integration', () => {
    it('should work with CacheKeyBuilder keys', async () => {
      const builder = new CacheKeyBuilder({ app: 'test', env: 'integration' });
      const key = builder.forTenant('legal').forOrg('org123').key('data');

      await client.set(key, { test: true });
      const result = await client.get(key);

      expect(result).toEqual({ test: true });

      // Clean up using pattern
      const pattern = builder.forTenant('legal').toPattern();
      const removed = await client.removeByPrefix(pattern);
      expect(removed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    it('should throw in throw mode when operation fails', async () => {
      // Create a client pointing to wrong port
      const badClient = new ResilientCacheClient({
        host: REDIS_HOST,
        port: 9999, // Wrong port
        onError: 'throw',
        connectTimeout: 500,
      });

      await expect(badClient.connect()).rejects.toThrow();
    });

    it('should return graceful defaults when disconnected', async () => {
      const disconnectedClient = new ResilientCacheClient({
        host: REDIS_HOST,
        port: 9999,
        onError: 'graceful',
      });

      // Don't connect - operations should return defaults
      const getResult = await disconnectedClient.get('key', 'default');
      expect(getResult).toBe('default');

      const setResult = await disconnectedClient.set('key', 'value');
      expect(setResult).toBe(false);

      const pingResult = await disconnectedClient.ping();
      expect(pingResult).toBe(false);
    });

    it('should allow per-call override of error handling', async () => {
      const gracefulClient = new ResilientCacheClient({
        host: REDIS_HOST,
        port: 9999,
        onError: 'graceful',
      });

      // Override to throw for this specific call
      await expect(gracefulClient.ping({ onError: 'throw' })).rejects.toThrow(
        CacheUnavailableError,
      );
    });
  });

  describe('connection state', () => {
    it('should track connection status', async () => {
      const status = client.getStatus();

      expect(status.state).toBe('connected');
      expect(status.lastConnectedAt).toBeInstanceOf(Date);
      expect(status.reconnectAttempts).toBe(0);
    });

    it('should notify on state changes', async () => {
      const states: string[] = [];
      const tempClient = new ResilientCacheClient({
        host: REDIS_HOST,
        port: REDIS_PORT,
      });

      tempClient.onStateChange((status) => {
        states.push(status.state);
      });

      await tempClient.connect();
      await tempClient.disconnect();

      expect(states).toContain('connecting');
      expect(states).toContain('connected');
      expect(states).toContain('disconnected');
    });
  });
});
