import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResilientCacheClient } from '../src/ResilientCacheClient.js';
import { CacheUnavailableError, CacheTimeoutError } from '../src/errors.js';

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
    scan: vi.fn().mockResolvedValue(['0', []]),
    flushdb: vi.fn().mockResolvedValue('OK'),
    incrby: vi.fn().mockResolvedValue(1),
    decrby: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(30),
    exists: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  return {
    default: vi.fn(() => mockRedisInstance),
  };
});

describe('ResilientCacheClient', () => {
  let client: ResilientCacheClient;

  const defaultOptions = {
    host: 'localhost',
    port: 6379,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    client = new ResilientCacheClient(defaultOptions);
  });

  afterEach(async () => {
    await client.disconnect();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      expect(client.getStatus().state).toBe('disconnected');
    });

    it('should start in disconnected state', () => {
      expect(client.isReady()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      await client.connect();
      expect(client.getStatus().state).toBe('connected');
    });

    it('should be ready after connection', async () => {
      await client.connect();
      expect(client.isReady()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.getStatus().state).toBe('disconnected');
    });
  });

  describe('getStatus', () => {
    it('should return current connection status', async () => {
      const status = client.getStatus();
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('reconnectAttempts');
    });

    it('should track lastConnectedAt after connection', async () => {
      await client.connect();
      const status = client.getStatus();
      expect(status.lastConnectedAt).toBeInstanceOf(Date);
    });
  });

  describe('ping', () => {
    it('should return true when connected', async () => {
      await client.connect();
      const result = await client.ping();
      expect(result).toBe(true);
    });

    it('should return false when not connected (graceful mode, autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.ping();
      expect(result).toBe(false);
    });

    it('should throw when not connected (throw mode, autoConnect disabled)', async () => {
      const throwClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'throw',
        autoConnect: false,
      });

      await expect(throwClient.ping()).rejects.toThrow(CacheUnavailableError);
    });
  });

  describe('get', () => {
    it('should return null for missing key', async () => {
      await client.connect();
      const result = await client.get('missing');
      expect(result).toBeNull();
    });

    it('should return default value when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.get('key', 'default');
      expect(result).toBe('default');
    });
  });

  describe('set', () => {
    it('should return true on success', async () => {
      await client.connect();
      const result = await client.set('key', 'value');
      expect(result).toBe(true);
    });

    it('should return false when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.set('key', 'value');
      expect(result).toBe(false);
    });
  });

  describe('remove', () => {
    it('should return true when key exists', async () => {
      await client.connect();
      const result = await client.remove('key');
      expect(result).toBe(true);
    });

    it('should return false when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.remove('key');
      expect(result).toBe(false);
    });
  });

  describe('removeByPrefix', () => {
    it('should return -1 when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.removeByPrefix('prefix:');
      expect(result).toBe(-1);
    });
  });

  describe('removeAll', () => {
    it('should return true on success', async () => {
      await client.connect();
      const result = await client.removeAll();
      expect(result).toBe(true);
    });
  });

  describe('increment', () => {
    it('should return incremented value', async () => {
      await client.connect();
      const result = await client.increment('counter');
      expect(result).toBe(1);
    });

    it('should return default when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.increment('counter', 1, 100);
      expect(result).toBe(100);
    });
  });

  describe('decrement', () => {
    it('should return decremented value', async () => {
      await client.connect();
      const result = await client.decrement('counter');
      expect(result).toBe(1);
    });
  });

  describe('decrementOrInit', () => {
    it('should return result from Lua script', async () => {
      await client.connect();
      const result = await client.decrementOrInit('ratelimit', 30, 60);
      expect(result).toBe(30);
    });

    it('should return default when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.decrementOrInit('ratelimit', 30, 60);
      expect(result).toBe(30);
    });
  });

  describe('onStateChange', () => {
    it('should notify on state changes', async () => {
      const callback = vi.fn();
      client.onStateChange(callback);

      await client.connect();

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'connecting' }),
      );
    });
  });

  describe('onError', () => {
    it('should register error callback', () => {
      const callback = vi.fn();
      client.onError(callback);
      // Callback is registered but not called without errors
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('per-call options', () => {
    it('should override default error handling for single call (autoConnect disabled)', async () => {
      const gracefulClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'graceful',
        autoConnect: false,
      });

      await expect(gracefulClient.ping({ onError: 'throw' })).rejects.toThrow(
        CacheUnavailableError,
      );
    });

    it('should use graceful when overriding throw client (autoConnect disabled)', async () => {
      const throwClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'throw',
        autoConnect: false,
      });

      const result = await throwClient.ping({ onError: 'graceful' });
      expect(result).toBe(false);
    });
  });

  describe('auto-connect', () => {
    it('should auto-connect on first command when autoConnect is true (default)', async () => {
      // client has autoConnect: true by default
      await client.ping();
      expect(client.getStatus().state).toBe('connected');
    });

    it('should not auto-connect when autoConnect is false', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.get('key', 'default');
      expect(result).toBe('default');
      expect(noAutoClient.getStatus().state).toBe('disconnected');
    });

    it('should track lastSuccessAt on successful operations', async () => {
      await client.connect();
      const beforeOp = new Date();
      await client.ping();
      const status = client.getStatus();
      expect(status.lastSuccessAt).toBeInstanceOf(Date);
      expect(status.lastSuccessAt!.getTime()).toBeGreaterThanOrEqual(
        beforeOp.getTime(),
      );
    });

    it('should set lastSuccessAt on connection', async () => {
      await client.connect();
      const status = client.getStatus();
      expect(status.lastSuccessAt).toBeInstanceOf(Date);
      expect(status.lastConnectedAt).toBeInstanceOf(Date);
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.exists as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await client.connect();
      const result = await client.exists('key');
      expect(result).toBe(true);
    });

    it('should return false when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.exists('key');
      expect(result).toBe(false);
    });
  });

  describe('ttl', () => {
    it('should return TTL value', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (
        mockInstance.ttl as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(60);

      await client.connect();
      const result = await client.ttl('key');
      expect(result).toBe(60);
    });

    it('should return -2 when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const result = await noAutoClient.ttl('key');
      expect(result).toBe(-2);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value on hit', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify('cached-value'),
      );

      await client.connect();
      const factory = vi.fn().mockResolvedValue('new-value');
      const result = await client.getOrSet('key', factory);

      expect(result).toBe('cached-value');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache on miss', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await client.connect();
      const factory = vi.fn().mockResolvedValue('new-value');
      const result = await client.getOrSet('key', factory, 60);

      expect(result).toBe('new-value');
      expect(factory).toHaveBeenCalledOnce();
      expect(mockInstance.set).toHaveBeenCalled();
    });

    it('should call factory when not connected (autoConnect disabled)', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const factory = vi.fn().mockResolvedValue('fallback-value');
      const result = await noAutoClient.getOrSet('key', factory);

      expect(result).toBe('fallback-value');
      expect(factory).toHaveBeenCalledOnce();
    });
  });
});

describe('CacheTimeoutError', () => {
  it('should have correct properties', () => {
    const error = new CacheTimeoutError('get', 500);
    expect(error.name).toBe('CacheTimeoutError');
    expect(error.operation).toBe('get');
    expect(error.timeoutMs).toBe(500);
    expect(error.message).toContain('get');
    expect(error.message).toContain('500ms');
  });
});

describe('CacheUnavailableError', () => {
  it('should have correct properties', () => {
    const cause = new Error('connection failed');
    const error = new CacheUnavailableError('Cache unavailable', cause, 'set');
    expect(error.name).toBe('CacheUnavailableError');
    expect(error.cause).toBe(cause);
    expect(error.operation).toBe('set');
  });
});
