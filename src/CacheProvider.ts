import type { ICacheClient } from './types.js';

/**
 * Factory/DI container for cache client instances
 * Provides a singleton pattern for accessing the cache client throughout the application
 *
 * @example
 * ```typescript
 * // At app startup
 * const client = new ResilientCacheClient({ host: 'localhost', port: 6379 });
 * CacheProvider.initialize(client);
 *
 * // In service code
 * const cache = CacheProvider.getClient();
 * const value = await cache.get('mykey');
 * ```
 */
export class CacheProvider {
  private static client: ICacheClient | null = null;

  /**
   * Initialize the cache provider with a client instance
   * @param client - The cache client to use
   * @throws Error if already initialized (call reset() first to reinitialize)
   */
  static initialize(client: ICacheClient): void {
    if (CacheProvider.client !== null) {
      throw new Error(
        'CacheProvider is already initialized. Call reset() first to reinitialize.',
      );
    }
    CacheProvider.client = client;
  }

  /**
   * Get the initialized cache client
   * @returns The cache client instance
   * @throws Error if not initialized
   */
  static getClient(): ICacheClient {
    if (CacheProvider.client === null) {
      throw new Error(
        'CacheProvider is not initialized. Call initialize() first.',
      );
    }
    return CacheProvider.client;
  }

  /**
   * Check if the provider has been initialized
   */
  static isInitialized(): boolean {
    return CacheProvider.client !== null;
  }

  /**
   * Reset the provider (useful for testing)
   */
  static reset(): void {
    CacheProvider.client = null;
  }
}
