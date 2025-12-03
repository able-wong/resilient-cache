# resilient-cache

[![Lint and Test](https://github.com/able-wong/resilient-cache/actions/workflows/lint_and_test.yml/badge.svg)](https://github.com/able-wong/resilient-cache/actions/workflows/lint_and_test.yml)

Resilient Redis/Valkey cache client with graceful degradation, fast failure detection, and circuit breaker-style reconnection.

## Features

- **Non-critical**: App works even if cache is down
- **Fail-fast**: Quick failure timeout (don't wait for slow connections)
- **Circuit breaker**: Automatic cooldown after failure, prevents cascade failures
- **Graceful degradation**: Return default values when unavailable
- **Configurable error handling**: Graceful (default) or throw exceptions
- **Await-friendly API**: Modern async/await interface
- **Replaceable**: Provider pattern for swapping implementations
- **TypeScript**: Full type safety with comprehensive type definitions

## Installation

```bash
npm install resilient-cache
```

**Requirements:** Node.js >= 20.0.0

---

## Usage

### Basic Usage (Graceful Mode - Default)

```typescript
import { ResilientCacheClient, CacheKeyBuilder, CacheProvider } from 'resilient-cache';

// Initialize at app startup
const client = new ResilientCacheClient({
  host: process.env.REDIS_HOST!,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  // onError: 'graceful' is the default
});

await client.connect();
CacheProvider.initialize(client);

// Key builder for consistent key naming
const keys = new CacheKeyBuilder({ app: 'myapp', env: 'production' });

// In service code - returns null if cache unavailable (no try/catch needed)
const orgKeys = keys.forTenant('legal').forOrg('org123');
const cached = await client.get(orgKeys.key('prompts'), null);

if (!cached) {
  // Cache miss or unavailable - fetch from DB
  const fresh = await loadFromDatabase();
  await client.set(orgKeys.key('prompts'), fresh, 7200); // Returns false if unavailable
}
```

### Throw Mode for Specific Calls

```typescript
import { CacheProvider, CacheUnavailableError } from 'resilient-cache';

// In admin action handler where you want to show errors
export async function clearCache() {
  const client = CacheProvider.getClient();

  try {
    // Override to throw - we want to show errors in UI
    const keysDeleted = await client.removeByPrefix('myapp:*', { onError: 'throw' });
    return { success: true, keysDeleted };
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      return { success: false, error: 'Cache is unavailable' };
    }
    throw error;
  }
}
```

### Rate Limiting (Fail-Open)

```typescript
const rateLimitKey = keys.forOrg(orgId).key('ratelimit:chat');

// Graceful: returns defaultValue (30) if cache unavailable
// This means rate limiting is disabled when cache is down (fail-open)
const remaining = await client.decrementOrInit(rateLimitKey, 30, 90);

if (remaining < 0) {
  throw new RateLimitError('Too many requests');
}
```

### Health Check Endpoint

```typescript
// GET /api/health/cache
export async function cacheHealthCheck() {
  const client = CacheProvider.getClient();

  try {
    // Throw mode to detect actual connectivity
    await client.ping({ onError: 'throw' });
    return { status: 'healthy', connected: true };
  } catch (error) {
    return { status: 'unhealthy', connected: false, error: error.message };
  }
}
```

### Testing with MockCacheClient

```typescript
import { MockCacheClient, CacheProvider } from 'resilient-cache';

describe('MyService', () => {
  beforeEach(() => {
    CacheProvider.reset();
    CacheProvider.initialize(new MockCacheClient());
  });

  it('should handle cache failure gracefully', async () => {
    const mockClient = CacheProvider.getClient() as MockCacheClient;
    mockClient.setSimulateFailure(true);

    // Your service should still work
    const result = await myService.getData();
    expect(result).toBeDefined();
  });
});
```

---

## API Reference

### ResilientCacheClient

```typescript
const client = new ResilientCacheClient({
  host: string;              // Redis/Valkey host
  port: number;              // Redis/Valkey port
  password?: string;         // Password (optional)
  connectTimeout?: number;   // Connection timeout in ms (default: 1000)
  commandTimeout?: number;   // Command timeout in ms (default: 500)
  reconnectDelay?: number;   // Delay before reconnect in ms (default: 10000)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: Infinity)
  enableOfflineQueue?: boolean;  // Queue commands when disconnected (default: false)
  onError?: 'graceful' | 'throw'; // Error handling mode (default: 'graceful')
});
```

#### Methods

| Method | Return (graceful) | Return (throw) |
|--------|-------------------|----------------|
| `connect()` | `Promise<void>` | `Promise<void>` |
| `disconnect()` | `Promise<void>` | `Promise<void>` |
| `isReady()` | `boolean` | `boolean` |
| `getStatus()` | `ConnectionStatus` | `ConnectionStatus` |
| `ping(options?)` | `false` | throws `CacheUnavailableError` |
| `get<T>(key, defaultValue?, options?)` | `defaultValue \| null` | throws `CacheUnavailableError` |
| `set<T>(key, value, ttlSeconds?, options?)` | `false` | throws `CacheUnavailableError` |
| `remove(key, options?)` | `false` | throws `CacheUnavailableError` |
| `removeByPrefix(prefix, options?)` | `-1` | throws `CacheUnavailableError` |
| `removeAll(options?)` | `false` | throws `CacheUnavailableError` |
| `increment(key, amount?, defaultValue?, options?)` | `defaultValue` | throws `CacheUnavailableError` |
| `decrement(key, amount?, defaultValue?, options?)` | `defaultValue` | throws `CacheUnavailableError` |
| `decrementOrInit(key, defaultValue, ttlSeconds, options?)` | `defaultValue` | throws `CacheUnavailableError` |

### CacheKeyBuilder

```typescript
const keys = new CacheKeyBuilder({ app: 'myapp', env: 'production' });

keys.forTenant('legal');           // Add tenant scope
keys.forOrg('org123');             // Add org scope
keys.forUser('user456');           // Add user scope
keys.build();                      // Get prefix string
keys.key('suffix');                // Get full key with suffix
keys.toPattern();                  // Get pattern for removeByPrefix
keys.clone();                      // Create independent copy
```

### CacheProvider

```typescript
CacheProvider.initialize(client);  // Initialize with client
CacheProvider.getClient();         // Get initialized client
CacheProvider.isInitialized();     // Check if initialized
CacheProvider.reset();             // Reset (for testing)
```

### Error Classes

```typescript
import { CacheUnavailableError, CacheTimeoutError } from 'resilient-cache';

// CacheUnavailableError - thrown when cache operation fails
error.cause;      // Original error
error.operation;  // Operation that failed ('get', 'set', etc.)

// CacheTimeoutError extends CacheUnavailableError
error.timeoutMs;  // Timeout duration
```

---

## Connection State Machine

```
                    ┌─────────────┐
                    │disconnected │
                    └──────┬──────┘
                           │ connect()
                           ▼
                    ┌─────────────┐
              ┌────►│ connecting  │◄────┐
              │     └──────┬──────┘     │
              │            │            │
              │    success │   failure  │
              │            ▼            │
              │     ┌─────────────┐     │
              │     │  connected  │     │
              │     └──────┬──────┘     │
              │            │            │
              │    lost    │            │
              │            ▼            │
              │     ┌─────────────┐     │
              │     │reconnecting │─────┤
              │     └──────┬──────┘     │
              │            │            │
              │    failure │            │
              │            ▼            │
     cooldown │     ┌─────────────┐     │
     expires  └─────│  cooldown   │     │
                    └──────┬──────┘     │
                           │            │
               max retries │            │
                           ▼            │
                    ┌─────────────┐     │
                    │   failed    │─────┘
                    └─────────────┘  manual reconnect
```

This is a simplified [circuit breaker pattern](https://martinfowler.com/bliki/CircuitBreaker.html):

| Circuit Breaker | This Library | Behavior |
|-----------------|--------------|----------|
| CLOSED | `connected` | Normal operation |
| OPEN | `cooldown` | Reject immediately, don't attempt connection |
| HALF-OPEN | `reconnecting` | Test if service recovered |

**Key difference**: Unlike a traditional circuit breaker that trips after N failures, this library enters cooldown immediately on any connection failure. This is appropriate for cache clients where a single timeout already indicates the server is struggling.

---

## Development

### Prerequisites

- Node.js >= 20.0.0
- Docker (for integration tests)

### Setup

```bash
# Clone the repository
git clone https://github.com/able-wong/resilient-cache.git
cd resilient-cache

# Install dependencies
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:coverage` | Run unit tests with coverage |
| `npm run test:integration` | Run integration tests (starts Docker Redis automatically) |
| `npm run test:all` | Run both unit and integration tests |
| `npm run lint` | Check code style |
| `npm run lint:fix` | Fix code style issues |

### Project Structure

```
resilient-cache/
├── src/
│   ├── index.ts                 # Public exports
│   ├── types.ts                 # Type definitions
│   ├── errors.ts                # Custom error classes
│   ├── ResilientCacheClient.ts  # Main client implementation
│   ├── CacheKeyBuilder.ts       # Key prefix utility
│   ├── CacheProvider.ts         # Factory/DI pattern
│   └── MockCacheClient.ts       # In-memory mock for testing
├── tests/
│   ├── *.test.ts                # Unit tests
│   └── integration/             # Integration tests (require Docker)
├── dist/                        # Compiled output (generated)
├── docker-compose.yml           # Redis for integration tests
├── vitest.config.ts             # Unit test config
└── vitest.integration.config.ts # Integration test config
```

### Running Integration Tests

Integration tests run against a real Redis instance via Docker:

```bash
npm run test:integration
```

This command automatically:
1. Starts a Redis container (`docker compose up -d --wait`)
2. Waits for Redis health check to pass
3. Runs the integration test suite
4. Stops and removes the container (`docker compose down`)

To run Redis manually for development:

```bash
# Start Redis
docker compose up -d

# Run tests (multiple times if needed)
npx vitest run --config vitest.integration.config.ts

# Stop Redis when done
docker compose down
```

### Code Style

- ESLint + Prettier for formatting
- Single quotes, semicolons, trailing commas
- Run `npm run lint:fix` before committing

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm run test:all`)
5. Run linter (`npm run lint:fix`)
6. Commit your changes
7. Push to your fork
8. Open a Pull Request

---

## License

Apache-2.0
