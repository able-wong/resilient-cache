// Main exports
export { ResilientCacheClient } from './ResilientCacheClient.js';
export { CacheKeyBuilder } from './CacheKeyBuilder.js';
export { CacheProvider } from './CacheProvider.js';
export { MockCacheClient, WrongTypeError } from './MockCacheClient.js';

// Error classes
export { CacheUnavailableError, CacheTimeoutError } from './errors.js';

// Types
export type {
  CacheClientOptions,
  CallOptions,
  ConnectionState,
  ConnectionStatus,
  ICacheClient,
  CacheKeyConfig,
} from './types.js';
