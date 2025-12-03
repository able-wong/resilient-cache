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

    it('should return false when not connected (graceful mode)', async () => {
      const result = await client.ping();
      expect(result).toBe(false);
    });

    it('should throw when not connected (throw mode)', async () => {
      const throwClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'throw',
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

    it('should return default value when not connected', async () => {
      const result = await client.get('key', 'default');
      expect(result).toBe('default');
    });
  });

  describe('set', () => {
    it('should return true on success', async () => {
      await client.connect();
      const result = await client.set('key', 'value');
      expect(result).toBe(true);
    });

    it('should return false when not connected', async () => {
      const result = await client.set('key', 'value');
      expect(result).toBe(false);
    });
  });

  describe('remove', () => {
    it('should return true when key exists', async () => {
      await client.connect();
      const result = await client.remove('key');
      expect(result).toBe(true);
    });

    it('should return false when not connected', async () => {
      const result = await client.remove('key');
      expect(result).toBe(false);
    });
  });

  describe('removeByPrefix', () => {
    it('should return -1 when not connected', async () => {
      const result = await client.removeByPrefix('prefix:');
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

    it('should return default when not connected', async () => {
      const result = await client.increment('counter', 1, 100);
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

    it('should return default when not connected', async () => {
      const result = await client.decrementOrInit('ratelimit', 30, 60);
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
    it('should override default error handling for single call', async () => {
      const gracefulClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'graceful',
      });

      await expect(gracefulClient.ping({ onError: 'throw' })).rejects.toThrow(
        CacheUnavailableError,
      );
    });

    it('should use graceful when overriding throw client', async () => {
      const throwClient = new ResilientCacheClient({
        ...defaultOptions,
        onError: 'throw',
      });

      const result = await throwClient.ping({ onError: 'graceful' });
      expect(result).toBe(false);
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
