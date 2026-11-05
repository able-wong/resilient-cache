// Main exports
export { ResilientCacheClient } from './ResilientCacheClient.js';
export { CacheKeyBuilder, buildCacheKey } from './CacheKeyBuilder.js';
export type { CacheKeyScope } from './CacheKeyBuilder.js';
export { CacheProvider } from './CacheProvider.js';
export { MockCacheClient, WrongTypeError } from './MockCacheClient.js';
export { NullCacheClient } from './NullCacheClient.js';

// Error classes
export { CacheUnavailableError, CacheTimeoutError } from './errors.js';

// Types
export type {
  CacheClientOptions,
  CacheLogFn,
  CacheLogger,
  CallOptions,
  ConnectionState,
  ConnectionStatus,
  GetOptions,
  GetOrSetOptions,
  ICacheClient,
  CacheKeyConfig,
} from './types.js';
