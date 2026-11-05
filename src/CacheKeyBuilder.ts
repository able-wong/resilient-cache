import type { CacheKeyConfig } from './types.js';

/** Allowed characters in a key version. Keeps `:`, whitespace and newlines out of keys. */
const VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Scopes accepted by buildCacheKey, applied in this order: tenant, org, user */
export interface CacheKeyScope {
  tenant?: string;
  org?: string;
  user?: string;
}

/**
 * Validate a key version and normalize it to a string
 * @throws TypeError if the version is empty or contains disallowed characters
 */
function normalizeVersion(
  version: string | number | undefined,
): string | undefined {
  if (version === undefined) {
    return undefined;
  }
  const normalized = String(version);
  if (!VERSION_PATTERN.test(normalized)) {
    throw new TypeError(
      'Cache key version must be non-empty and contain only letters, digits, ".", "_" or "-"',
    );
  }
  return normalized;
}

function baseSegments(config: CacheKeyConfig): string[] {
  return [`app:${config.app}`, `env:${config.env}`];
}

/**
 * Join prefix segments, the optional version and the suffix into a full key.
 * Used by CacheKeyBuilder.key(); buildCacheKey() goes through the builder.
 */
function joinKey(
  segments: readonly string[],
  version: string | undefined,
  suffix: string,
): string {
  const parts = [...segments];
  if (version !== undefined) {
    parts.push(`v:${version}`);
  }
  parts.push(suffix);
  return parts.join(':');
}

/**
 * Build a cache key without creating a builder. Pure function.
 *
 * @example
 * ```typescript
 * buildCacheKey({ app: 'myapp', env: 'production', version: 2 }, 'prompts', {
 *   tenant: 'legal',
 *   org: 'org123',
 * });
 * // => "app:myapp:env:production:tenant:legal:org:org123:v:2:prompts"
 * ```
 */
export function buildCacheKey(
  config: CacheKeyConfig,
  suffix: string,
  scope: CacheKeyScope = {},
): string {
  // Delegates to the builder so the key format lives in one place
  let builder = new CacheKeyBuilder(config);
  if (scope.tenant !== undefined) builder = builder.forTenant(scope.tenant);
  if (scope.org !== undefined) builder = builder.forOrg(scope.org);
  if (scope.user !== undefined) builder = builder.forUser(scope.user);
  return builder.key(suffix);
}

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
 * // With a version, it goes just before the suffix
 * new CacheKeyBuilder({ app: 'myapp', env: 'production', version: 2 }).key('prompts');
 * // => "app:myapp:env:production:v:2:prompts"
 *
 * // Get pattern for prefix matching (version-free, matches all versions)
 * const pattern = builder.forTenant('legal').toPattern();
 * // => "app:myapp:env:production:tenant:legal:*"
 * ```
 */
export class CacheKeyBuilder {
  private segments: string[] = [];
  private version: string | undefined;

  /**
   * Create a new CacheKeyBuilder
   * @param config - Base configuration with app name, environment and optional version
   * @throws TypeError if config.version is invalid
   */
  constructor(config: CacheKeyConfig) {
    this.segments = baseSegments(config);
    this.version = normalizeVersion(config.version);
  }

  /**
   * Private constructor for cloning
   */
  private static fromSegments(
    segments: string[],
    version: string | undefined,
  ): CacheKeyBuilder {
    const builder = Object.create(CacheKeyBuilder.prototype) as CacheKeyBuilder;
    builder.segments = [...segments];
    builder.version = version;
    return builder;
  }

  private withSegment(segment: string): CacheKeyBuilder {
    const cloned = CacheKeyBuilder.fromSegments(this.segments, this.version);
    cloned.segments.push(segment);
    return cloned;
  }

  /**
   * Add a tenant scope to the key
   * @param tenant - Tenant identifier
   */
  forTenant(tenant: string): CacheKeyBuilder {
    return this.withSegment(`tenant:${tenant}`);
  }

  /**
   * Add an organization scope to the key
   * @param orgId - Organization identifier
   */
  forOrg(orgId: string): CacheKeyBuilder {
    return this.withSegment(`org:${orgId}`);
  }

  /**
   * Add a user scope to the key
   * @param userId - User identifier
   */
  forUser(userId: string): CacheKeyBuilder {
    return this.withSegment(`user:${userId}`);
  }

  /**
   * Build the key prefix (without the version or a suffix)
   * @returns The key prefix string
   */
  build(): string {
    return this.segments.join(':');
  }

  /**
   * Build a full key with the given suffix (and the version, if configured)
   * @param suffix - The key suffix (e.g., 'ratelimit', 'session')
   * @returns The full cache key
   */
  key(suffix: string): string {
    return joinKey(this.segments, this.version, suffix);
  }

  /**
   * Get a pattern for matching keys with this prefix
   * Used with removeByPrefix for wildcard matching.
   * Version-free on purpose, so it matches keys of every version.
   * @returns The pattern string with wildcard
   */
  toPattern(): string {
    return `${this.build()}:*`;
  }

  /**
   * Create a copy of this builder
   * @returns A new CacheKeyBuilder with the same segments and version
   */
  clone(): CacheKeyBuilder {
    return CacheKeyBuilder.fromSegments(this.segments, this.version);
  }
}
