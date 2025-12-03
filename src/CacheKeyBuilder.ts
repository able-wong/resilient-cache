import type { CacheKeyConfig } from './types.js';

/**
 * Utility class for building consistent cache keys with hierarchical structure
 *
 * @example
 * ```typescript
 * const builder = new CacheKeyBuilder({ app: 'myapp', env: 'production' });
 *
 * // Build a key for a specific tenant and org
 * const key = builder.forTenant('legal').forOrg('org123').key('ratelimit');
 * // => "app:myapp:env:production:tenant:legal:org:org123:ratelimit"
 *
 * // Get pattern for prefix matching
 * const pattern = builder.forTenant('legal').toPattern();
 * // => "app:myapp:env:production:tenant:legal:*"
 * ```
 */
export class CacheKeyBuilder {
  private readonly segments: string[] = [];

  /**
   * Create a new CacheKeyBuilder
   * @param config - Base configuration with app name and environment
   */
  constructor(config: CacheKeyConfig) {
    this.segments.push(`app:${config.app}`);
    this.segments.push(`env:${config.env}`);
  }

  /**
   * Private constructor for cloning
   */
  private static fromSegments(segments: string[]): CacheKeyBuilder {
    const builder = Object.create(CacheKeyBuilder.prototype);
    builder.segments = [...segments];
    return builder;
  }

  /**
   * Add a tenant scope to the key
   * @param tenant - Tenant identifier
   */
  forTenant(tenant: string): CacheKeyBuilder {
    const cloned = CacheKeyBuilder.fromSegments(this.segments);
    cloned.segments.push(`tenant:${tenant}`);
    return cloned;
  }

  /**
   * Add an organization scope to the key
   * @param orgId - Organization identifier
   */
  forOrg(orgId: string): CacheKeyBuilder {
    const cloned = CacheKeyBuilder.fromSegments(this.segments);
    cloned.segments.push(`org:${orgId}`);
    return cloned;
  }

  /**
   * Add a user scope to the key
   * @param userId - User identifier
   */
  forUser(userId: string): CacheKeyBuilder {
    const cloned = CacheKeyBuilder.fromSegments(this.segments);
    cloned.segments.push(`user:${userId}`);
    return cloned;
  }

  /**
   * Build the key prefix (without a suffix)
   * @returns The key prefix string
   */
  build(): string {
    return this.segments.join(':');
  }

  /**
   * Build a full key with the given suffix
   * @param suffix - The key suffix (e.g., 'ratelimit', 'session')
   * @returns The full cache key
   */
  key(suffix: string): string {
    return `${this.build()}:${suffix}`;
  }

  /**
   * Get a pattern for matching keys with this prefix
   * Used with removeByPrefix for wildcard matching
   * @returns The pattern string with wildcard
   */
  toPattern(): string {
    return `${this.build()}:*`;
  }

  /**
   * Create a copy of this builder
   * @returns A new CacheKeyBuilder with the same segments
   */
  clone(): CacheKeyBuilder {
    return CacheKeyBuilder.fromSegments(this.segments);
  }
}
