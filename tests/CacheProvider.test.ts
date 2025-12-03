import { describe, it, expect, beforeEach } from 'vitest';
import { CacheProvider } from '../src/CacheProvider.js';
import { MockCacheClient } from '../src/MockCacheClient.js';

describe('CacheProvider', () => {
  beforeEach(() => {
    CacheProvider.reset();
  });

  describe('initialize', () => {
    it('should initialize with a client', () => {
      const client = new MockCacheClient();
      CacheProvider.initialize(client);
      expect(CacheProvider.isInitialized()).toBe(true);
    });

    it('should throw if already initialized', () => {
      const client = new MockCacheClient();
      CacheProvider.initialize(client);

      expect(() => {
        CacheProvider.initialize(new MockCacheClient());
      }).toThrow('CacheProvider is already initialized');
    });
  });

  describe('getClient', () => {
    it('should return initialized client', () => {
      const client = new MockCacheClient();
      CacheProvider.initialize(client);

      const retrieved = CacheProvider.getClient();
      expect(retrieved).toBe(client);
    });

    it('should throw if not initialized', () => {
      expect(() => {
        CacheProvider.getClient();
      }).toThrow('CacheProvider is not initialized');
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(CacheProvider.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      CacheProvider.initialize(new MockCacheClient());
      expect(CacheProvider.isInitialized()).toBe(true);
    });

    it('should return false after reset', () => {
      CacheProvider.initialize(new MockCacheClient());
      CacheProvider.reset();
      expect(CacheProvider.isInitialized()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should allow re-initialization after reset', () => {
      const client1 = new MockCacheClient();
      const client2 = new MockCacheClient();

      CacheProvider.initialize(client1);
      CacheProvider.reset();
      CacheProvider.initialize(client2);

      expect(CacheProvider.getClient()).toBe(client2);
    });
  });

  describe('usage pattern', () => {
    it('should work with typical app startup pattern', async () => {
      // App startup
      const client = new MockCacheClient();
      CacheProvider.initialize(client);

      // In service code
      const cache = CacheProvider.getClient();
      await cache.set('key', 'value');
      const result = await cache.get('key');

      expect(result).toBe('value');
    });
  });
});
