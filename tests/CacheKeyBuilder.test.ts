import { describe, it, expect } from 'vitest';
import { CacheKeyBuilder } from '../src/CacheKeyBuilder.js';

describe('CacheKeyBuilder', () => {
  const baseConfig = { app: 'myapp', env: 'production' };

  describe('constructor', () => {
    it('should create builder with app and env segments', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      expect(builder.build()).toBe('app:myapp:env:production');
    });
  });

  describe('forTenant', () => {
    it('should add tenant segment', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const withTenant = builder.forTenant('legal');
      expect(withTenant.build()).toBe('app:myapp:env:production:tenant:legal');
    });

    it('should not mutate original builder', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      builder.forTenant('legal');
      expect(builder.build()).toBe('app:myapp:env:production');
    });
  });

  describe('forOrg', () => {
    it('should add org segment', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const withOrg = builder.forOrg('org123');
      expect(withOrg.build()).toBe('app:myapp:env:production:org:org123');
    });

    it('should chain after tenant', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const withTenantAndOrg = builder.forTenant('legal').forOrg('org123');
      expect(withTenantAndOrg.build()).toBe(
        'app:myapp:env:production:tenant:legal:org:org123',
      );
    });
  });

  describe('forUser', () => {
    it('should add user segment', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const withUser = builder.forUser('user456');
      expect(withUser.build()).toBe('app:myapp:env:production:user:user456');
    });

    it('should chain after tenant and org', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const full = builder
        .forTenant('legal')
        .forOrg('org123')
        .forUser('user456');
      expect(full.build()).toBe(
        'app:myapp:env:production:tenant:legal:org:org123:user:user456',
      );
    });
  });

  describe('key', () => {
    it('should append suffix to build result', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      expect(builder.key('ratelimit')).toBe(
        'app:myapp:env:production:ratelimit',
      );
    });

    it('should work with chained builders', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const key = builder.forTenant('legal').forOrg('org123').key('ratelimit');
      expect(key).toBe(
        'app:myapp:env:production:tenant:legal:org:org123:ratelimit',
      );
    });
  });

  describe('toPattern', () => {
    it('should return pattern with wildcard', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      expect(builder.toPattern()).toBe('app:myapp:env:production:*');
    });

    it('should work with chained builders', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const pattern = builder.forTenant('legal').toPattern();
      expect(pattern).toBe('app:myapp:env:production:tenant:legal:*');
    });
  });

  describe('clone', () => {
    it('should create independent copy', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      const cloned = builder.clone();

      // Modify cloned
      const withTenant = cloned.forTenant('legal');

      // Original should be unchanged
      expect(builder.build()).toBe('app:myapp:env:production');
      expect(withTenant.build()).toBe('app:myapp:env:production:tenant:legal');
    });
  });
});
