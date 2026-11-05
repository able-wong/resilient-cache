import { describe, it, expect, vi, afterEach } from 'vitest';
import pino from 'pino';
import { ResilientCacheClient } from '../src/ResilientCacheClient.js';
import type { CacheLogger } from '../src/types.js';

vi.mock('ioredis', () => ({
  default: vi.fn(function () {
    return {
      status: 'ready',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  }),
}));

/** A pino instance writing JSON lines into memory */
function createCapturingPino() {
  const lines: Record<string, unknown>[] = [];
  // pino accepts any object with write(msg) as a destination
  const destination = {
    write(chunk: string) {
      for (const line of chunk.split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line));
      }
    },
  };
  return { logger: pino({ level: 'debug' }, destination), lines };
}

describe('CacheLogger compatibility', () => {
  let client: ResilientCacheClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    // Restore after disconnect so its log line stays muted
    vi.restoreAllMocks();
  });

  it('accepts a pino instance and keeps both context and message', async () => {
    const { logger, lines } = createCapturingPino();
    // Type-level check: a pino instance is assignable to CacheLogger
    const cacheLogger: CacheLogger = logger;
    client = new ResilientCacheClient({
      host: 'localhost',
      port: 6379,
      logger: cacheLogger,
    });

    await client.connect();

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 30, // pino "info"
        msg: 'Cache connected',
        host: 'localhost',
        port: 6379,
      }),
    );
  });

  it('accepts console', async () => {
    // Type-level check: console is assignable to CacheLogger
    const cacheLogger: CacheLogger = console;
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    client = new ResilientCacheClient({
      host: 'localhost',
      port: 6379,
      logger: cacheLogger,
    });

    await client.connect();

    expect(info).toHaveBeenCalledWith(
      { host: 'localhost', port: 6379 },
      'Cache connected',
    );
  });
});
