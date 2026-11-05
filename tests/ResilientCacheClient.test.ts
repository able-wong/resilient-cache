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
    default: vi.fn(function () {
      return mockRedisInstance;
    }),
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

  describe('get with isValid', () => {
    const mockStoredValue = async (value: unknown) => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        value === null ? null : JSON.stringify(value),
      );
      await client.connect();
    };

    it('should return the value when it passes', async () => {
      await mockStoredValue({ v: 2 });
      const isValid = vi.fn().mockReturnValue(true);
      expect(await client.get('key', undefined, { isValid })).toEqual({ v: 2 });
      expect(isValid).toHaveBeenCalledWith({ v: 2 });
    });

    it('should treat a failing value as a miss', async () => {
      await mockStoredValue({ v: 1 });
      const isValid = () => false;
      expect(await client.get('key', undefined, { isValid })).toBeNull();
    });

    it('should return the default value when the value fails', async () => {
      await mockStoredValue({ v: 1 });
      expect(
        await client.get('key', { v: 0 }, { isValid: () => false }),
      ).toEqual({ v: 0 });
    });

    it('should treat a throwing validator as a miss, even in throw mode', async () => {
      await mockStoredValue({ v: 1 });
      const isValid = () => {
        throw new Error('bad shape');
      };
      await expect(
        client.get('key', undefined, { isValid, onError: 'throw' }),
      ).resolves.toBeNull();
    });

    it('should support an async validator', async () => {
      await mockStoredValue({ v: 1 });
      const isValid = vi.fn().mockResolvedValue(false);
      expect(await client.get('key', undefined, { isValid })).toBeNull();
    });

    it('should not call the validator on a miss', async () => {
      await mockStoredValue(null);
      const isValid = vi.fn().mockReturnValue(true);
      expect(await client.get('key', 'default', { isValid })).toBe('default');
      expect(isValid).not.toHaveBeenCalled();
    });

    it('should not call the validator when the cache is unavailable', async () => {
      const noAutoClient = new ResilientCacheClient({
        ...defaultOptions,
        autoConnect: false,
      });
      const isValid = vi.fn().mockReturnValue(true);
      expect(await noAutoClient.get('key', 'default', { isValid })).toBe(
        'default',
      );
      expect(isValid).not.toHaveBeenCalled();
    });

    it('should not count a slow validator against commandTimeout', async () => {
      await mockStoredValue({ v: 1 });
      const isValid = () =>
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(true), 5000),
        );
      const pending = client.get('key', undefined, {
        isValid,
        onError: 'throw',
      });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual({ v: 1 });
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

  describe('logger', () => {
    const createLogger = () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const connectionRefused = () =>
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });

    const getMockRedis = async () => {
      const Redis = (await import('ioredis')).default;
      return new Redis() as unknown as Record<string, ReturnType<typeof vi.fn>>;
    };

    const allLoggedContexts = (logger: ReturnType<typeof createLogger>) =>
      Object.values(logger).flatMap((fn) =>
        fn.mock.calls.map((call) => JSON.stringify(call)),
      );

    it('should log connecting at debug and connected at info', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({ ...defaultOptions, logger });

      await logged.connect();

      expect(logger.debug).toHaveBeenCalledWith(
        { host: 'localhost', port: 6379 },
        'Cache connecting',
      );
      expect(logger.info).toHaveBeenCalledWith(
        { host: 'localhost', port: 6379 },
        'Cache connected',
      );
      await logged.disconnect();
    });

    it('should log disconnected at info', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({ ...defaultOptions, logger });

      await logged.connect();
      await logged.disconnect();

      expect(logger.info).toHaveBeenCalledWith(
        { host: 'localhost', port: 6379 },
        'Cache disconnected',
      );
    });

    it('should log cooldown at warn with cooldownEndsAt and the error', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({ ...defaultOptions, logger });
      const redis = await getMockRedis();
      redis.connect.mockRejectedValueOnce(connectionRefused());

      await expect(logged.connect()).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          cooldownEndsAt: expect.any(String),
          error: 'connect ECONNREFUSED',
        }),
        'Cache unavailable, entering cooldown',
      );
      await logged.disconnect();
    });

    it('should log failed at error when reconnect attempts are exhausted', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({
        ...defaultOptions,
        logger,
        maxReconnectAttempts: 1,
      });
      const redis = await getMockRedis();
      redis.connect.mockRejectedValueOnce(connectionRefused());

      await expect(logged.connect()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          reconnectAttempts: 1,
          error: 'connect ECONNREFUSED',
        }),
        'Cache reconnect attempts exhausted',
      );
      await logged.disconnect();
    });

    it('should log a command timeout at warn with the operation', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({ ...defaultOptions, logger });
      const redis = await getMockRedis();
      await logged.connect();
      redis.get.mockImplementationOnce(() => new Promise(() => {}));

      const pending = logged.get('key');
      await vi.advanceTimersByTimeAsync(500);

      expect(await pending).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'get' }),
        'Cache command failed',
      );
      await logged.disconnect();
    });

    it('should never log the password or cache keys', async () => {
      const logger = createLogger();
      const logged = new ResilientCacheClient({
        ...defaultOptions,
        password: 's3cret-pass',
        logger,
      });
      const redis = await getMockRedis();
      await logged.connect();
      redis.get.mockImplementationOnce(() => new Promise(() => {}));
      const pending = logged.get('app:x:user:secret-user-id:profile');
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      await logged.disconnect();

      const contexts = allLoggedContexts(logger);
      expect(contexts.length).toBeGreaterThan(0);
      for (const entry of contexts) {
        expect(entry).not.toContain('s3cret-pass');
        expect(entry).not.toContain('secret-user-id');
      }
    });

    it('should ignore a logger that throws', async () => {
      const throwing = () => {
        throw new Error('logger broke');
      };
      const logged = new ResilientCacheClient({
        ...defaultOptions,
        logger: {
          debug: throwing,
          info: throwing,
          warn: throwing,
          error: throwing,
        },
      });

      await expect(logged.connect()).resolves.toBeUndefined();
      expect(logged.getStatus().state).toBe('connected');
      await logged.disconnect();
    });

    it('should be silent and work normally without a logger', async () => {
      await expect(client.connect()).resolves.toBeUndefined();
      expect(client.getStatus().state).toBe('connected');
    });

    it('should give onStateChange callbacks cooldownEndsAt during cooldown', async () => {
      const callback = vi.fn();
      client.onStateChange(callback);
      const redis = await getMockRedis();
      redis.connect.mockRejectedValueOnce(connectionRefused());

      await expect(client.connect()).rejects.toThrow();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'cooldown',
          cooldownEndsAt: expect.any(Date),
        }),
      );
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

    it('should refetch and re-set when isValid returns false', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ v: 1 }),
      );

      await client.connect();
      const factory = vi.fn().mockResolvedValue({ v: 2 });
      const result = await client.getOrSet('key', factory, 60, {
        isValid: () => false,
      });

      expect(result).toEqual({ v: 2 });
      expect(factory).toHaveBeenCalledOnce();
      expect(mockInstance.set).toHaveBeenCalledWith(
        'key',
        JSON.stringify({ v: 2 }),
        'EX',
        60,
      );
    });

    it('should treat a throwing isValid as stale', async () => {
      const Redis = (await import('ioredis')).default;
      const mockInstance = new Redis();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ v: 1 }),
      );

      await client.connect();
      const factory = vi.fn().mockResolvedValue({ v: 2 });
      const result = await client.getOrSet('key', factory, 60, {
        isValid: () => {
          throw new Error('bad shape');
        },
      });

      expect(result).toEqual({ v: 2 });
      expect(factory).toHaveBeenCalledOnce();
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
