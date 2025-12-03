# resilient-cache

[![Lint and Test](https://github.com/able-wong/resilient-cache/actions/workflows/lint_and_test.yml/badge.svg)](https://github.com/able-wong/resilient-cache/actions/workflows/lint_and_test.yml)

Resilient Redis/Valkey cache client with graceful degradation, fast failure detection, and circuit breaker-style reconnection.

## Features

- **Non-critical**: App works even if cache is down
- **Fail-fast**: Quick failure timeout (don't wait for slow connections)
- **Circuit breaker**: Automatic cooldown after failure, prevents cascade failures
- **Graceful degradation**: Return default values when unavailable
- **Auto-connect**: No manual `connect()` required, lazy connection on first command
- **Cache-aside pattern**: Built-in `getOrSet()` for common fetch-or-compute pattern
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

// Initialize at app startup - no connect() needed, auto-connects on first command
const client = new ResilientCacheClient({
  host: process.env.REDIS_HOST!,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  // onError: 'graceful' is the default
  // autoConnect: true is the default
});

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

### Cache-Aside Pattern with getOrSet()

```typescript
// Simplify fetch-or-compute pattern with getOrSet()
const userData = await client.getOrSet(
  keys.forUser(userId).key('profile'),
  async () => {
    // Called only on cache miss
    return await fetchUserFromDatabase(userId);
  },
  3600 // TTL in seconds
);
// Returns cached value if available, otherwise calls factory and caches result
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
  throw new Error('Too many requests');
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

### Checking Key Existence and TTL

```typescript
// Check if a key exists before expensive operations
if (await client.exists(lockKey)) {
  throw new Error('Operation already in progress');
}

// Check remaining TTL for cache warming decisions
const remaining = await client.ttl(cacheKey);
if (remaining > 0 && remaining < 60) {
  // Cache expires soon - trigger background refresh
  refreshInBackground(cacheKey);
}
// Note: ttl() returns -1 if key has no TTL, -2 if key doesn't exist
```

### Monitoring Connection Status

```typescript
// Get detailed connection status for dashboards/monitoring
const status = client.getStatus();

console.log({
  state: status.state,              // 'connected', 'cooldown', 'failed', etc.
  lastSuccessAt: status.lastSuccessAt,  // Last successful operation
  lastError: status.lastError?.message,
  reconnectAttempts: status.reconnectAttempts,
  cooldownEndsAt: status.cooldownEndsAt,  // When cooldown expires (if in cooldown)
});

// Register for state change notifications
client.onStateChange((status) => {
  if (status.state === 'cooldown') {
    logger.warn('Cache entered cooldown', { error: status.lastError });
  } else if (status.state === 'connected') {
    logger.info('Cache reconnected');
  }
});
```

### Testing with MockCacheClient

```typescript
import { MockCacheClient, CacheProvider } from 'resilient-cache';

describe('MyService', () => {
  let mockClient: MockCacheClient;

  beforeEach(() => {
    mockClient = new MockCacheClient();
    CacheProvider.reset();
    CacheProvider.initialize(mockClient);
  });

  it('should handle cache failure gracefully', async () => {
    mockClient.setSimulateFailure(true);

    // Your service should still work
    const result = await myService.getData();
    expect(result).toBeDefined();
  });

  it('should use cached value when available', async () => {
    await mockClient.set('user:123', { name: 'John' });

    const result = await myService.getUser('123');
    expect(result.name).toBe('John');
  });

  it('should verify cache was populated', async () => {
    await myService.getUser('123'); // Should cache the result

    // Access internal store for assertions
    const store = mockClient.getStore();
    expect(store.has('user:123')).toBe(true);
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
  autoConnect?: boolean;     // Auto-connect on first command (default: true)
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
| `getOrSet<T>(key, factory, ttlSeconds?, options?)` | factory result | throws `CacheUnavailableError` |
| `exists(key, options?)` | `false` | throws `CacheUnavailableError` |
| `ttl(key, options?)` | `-2` | throws `CacheUnavailableError` |

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

## Design Principles

This library is built around the principle that **cache is non-critical infrastructure**. Your application should continue working even when Redis/Valkey is completely unavailable.

### Key Design Decisions

| Principle | Behavior |
|-----------|----------|
| **Always available** | All commands work even when Redis is down - they return graceful defaults |
| **No manual connect** | Auto-connects on first command, auto-reconnects after failures |
| **Fail fast** | Commands never block waiting for connection - return defaults immediately |
| **Command-driven reconnect** | Reconnection only happens when commands need it, not via background timers |
| **Circuit breaker** | After failure, enters cooldown to prevent retry storms |
| **Status transparency** | `getStatus()` provides real connection state for monitoring |

### Connection Behavior

```
Scenario: Redis starts down, comes up later

Request 1 → triggers connect attempt → fails → enters cooldown → returns default
Request 2 → cooldown active → returns default immediately (no retry)
Request 3 → cooldown active → returns default immediately (no retry)
...
[cooldown expires after 10s]
Request N → cooldown expired → triggers reconnect → Redis is back! → returns real value
Request N+1 → connected → returns real value
```

```
Scenario: Many concurrent requests during connection

Request 1 → triggers connect attempt → waiting...
Request 2 → sees "connecting" state → returns default immediately (fail fast)
Request 3 → sees "connecting" state → returns default immediately (fail fast)
...
Request 1 → connection succeeds → returns real value
Request N → now connected → returns real value
```

### When to Use Throw Mode

Use `{ onError: 'throw' }` only when you need to **know** if cache failed:

- Health check endpoints
- Admin cache management UIs
- Critical operations where cache failure should block the operation

For normal application code, use graceful mode (default) - your app keeps working.

---

## Connection State Machine

```
                    ┌─────────────┐
        first       │disconnected │
        command ───►└──────┬──────┘
                           │ auto-connect
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
              │     │  cooldown   │─────┤ failure
              │     └──────┬──────┘     │
              │            │            │
              │   cooldown │            │
              │   expired  │            │
              │   + command│            │
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│reconnecting │─────┘
                    └──────┬──────┘
                           │
               max retries │
                           ▼
                    ┌─────────────┐
                    │   failed    │───► next command resets & retries
                    └─────────────┘
```

This is a simplified [circuit breaker pattern](https://martinfowler.com/bliki/CircuitBreaker.html):

| Circuit Breaker | This Library | Behavior |
|-----------------|--------------|----------|
| CLOSED | `connected` | Normal operation |
| OPEN | `cooldown` | Reject immediately, don't attempt connection |
| HALF-OPEN | `reconnecting` | Test if service recovered |

**Key behaviors:**
- **No timers**: Reconnection is command-driven, not timer-driven. If no commands are issued, no reconnection attempts are made.
- **Immediate cooldown**: Unlike traditional circuit breakers that trip after N failures, this enters cooldown on any connection failure (appropriate for cache where one timeout means trouble).
- **Fail fast during connecting**: Concurrent requests during connection don't pile up - they get graceful defaults immediately.

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
