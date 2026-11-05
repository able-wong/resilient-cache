import { describe, it, expect } from 'vitest';
import { CacheKeyBuilder, buildCacheKey } from '../src/CacheKeyBuilder.js';

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

    it('should keep the version', () => {
      const builder = new CacheKeyBuilder({ ...baseConfig, version: 3 });
      expect(builder.clone().key('x')).toBe('app:myapp:env:production:v:3:x');
    });
  });

  describe('version', () => {
    it('should put the version just before the suffix', () => {
      const builder = new CacheKeyBuilder({ ...baseConfig, version: 2 });
      expect(builder.key('prompts')).toBe(
        'app:myapp:env:production:v:2:prompts',
      );
    });

    it('should put the version after all scopes', () => {
      const builder = new CacheKeyBuilder({ ...baseConfig, version: 2 });
      expect(
        builder.forTenant('legal').forOrg('org123').forUser('u1').key('p'),
      ).toBe('app:myapp:env:production:tenant:legal:org:org123:user:u1:v:2:p');
    });

    it('should leave keys unchanged when no version is set', () => {
      const builder = new CacheKeyBuilder(baseConfig);
      expect(builder.forTenant('legal').key('prompts')).toBe(
        'app:myapp:env:production:tenant:legal:prompts',
      );
    });

    it('should give different keys for different versions', () => {
      const v1 = new CacheKeyBuilder({ ...baseConfig, version: 1 });
      const v2 = new CacheKeyBuilder({ ...baseConfig, version: 2 });
      expect(v1.key('prompts')).not.toBe(v2.key('prompts'));
    });

    it('should accept a string version such as a short commit SHA', () => {
      const builder = new CacheKeyBuilder({
        ...baseConfig,
        version: 'a1b2c3d4e5',
      });
      expect(builder.key('prompts')).toBe(
        'app:myapp:env:production:v:a1b2c3d4e5:prompts',
      );
    });

    it('should accept dots, underscores and dashes', () => {
      const builder = new CacheKeyBuilder({
        ...baseConfig,
        version: '1.2_rc-1',
      });
      expect(builder.key('x')).toBe('app:myapp:env:production:v:1.2_rc-1:x');
    });

    it('should keep build() and toPattern() version-free', () => {
      const builder = new CacheKeyBuilder({ ...baseConfig, version: 2 });
      expect(builder.build()).toBe('app:myapp:env:production');
      expect(builder.forTenant('legal').toPattern()).toBe(
        'app:myapp:env:production:tenant:legal:*',
      );
    });

    it('should carry the version through scoped builders', () => {
      const builder = new CacheKeyBuilder({ ...baseConfig, version: 2 });
      const scoped = builder.forTenant('legal');
      expect(scoped.key('p')).toBe(
        'app:myapp:env:production:tenant:legal:v:2:p',
      );
    });

    it.each(['', 'a:b', 'a b', 'a\n', '*'])(
      'should reject invalid version %j',
      (version) => {
        expect(() => new CacheKeyBuilder({ ...baseConfig, version })).toThrow(
          TypeError,
        );
      },
    );
  });
});

describe('buildCacheKey', () => {
  const baseConfig = { app: 'myapp', env: 'production' };

  it('should build a key without scopes', () => {
    expect(buildCacheKey(baseConfig, 'feature_flags')).toBe(
      'app:myapp:env:production:feature_flags',
    );
  });

  it('should apply scopes in tenant, org, user order', () => {
    expect(
      buildCacheKey(baseConfig, 'p', { user: 'u1', org: 'o1', tenant: 't1' }),
    ).toBe('app:myapp:env:production:tenant:t1:org:o1:user:u1:p');
  });

  it('should match the builder for the same inputs', () => {
    const config = { ...baseConfig, version: 'abc123' };
    const fromBuilder = new CacheKeyBuilder(config)
      .forTenant('legal')
      .forOrg('org123')
      .key('prompts');
    expect(
      buildCacheKey(config, 'prompts', { tenant: 'legal', org: 'org123' }),
    ).toBe(fromBuilder);
  });

  it('should reject an invalid version', () => {
    expect(() =>
      buildCacheKey({ ...baseConfig, version: 'a:b' }, 'prompts'),
    ).toThrow(TypeError);
  });
});
