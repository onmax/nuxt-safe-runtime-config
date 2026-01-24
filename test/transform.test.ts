import { describe, expect, it } from 'vitest'
import { transformEnvVars } from '../src/utils/transform'

describe('transformEnvVars', () => {
  describe('camelCase conversion', () => {
    it('converts SCREAMING_SNAKE_CASE to camelCase', () => {
      const result = transformEnvVars([{ key: 'DATABASE_URL', value: 'postgres://localhost' }])
      expect(result).toEqual({ databaseUrl: 'postgres://localhost' })
    })

    it('handles single word keys', () => {
      const result = transformEnvVars([{ key: 'SECRET', value: 'abc123' }])
      expect(result).toEqual({ secret: 'abc123' })
    })

    it('handles deeply nested snake_case', () => {
      const result = transformEnvVars([{ key: 'MY_VERY_LONG_KEY_NAME', value: 'value' }])
      expect(result).toEqual({ myVeryLongKeyName: 'value' })
    })
  })

  describe('public namespace routing', () => {
    it('routes PUBLIC_* to public namespace', () => {
      const result = transformEnvVars([{ key: 'PUBLIC_API_URL', value: 'https://api.example.com' }])
      expect(result).toEqual({ public: { apiUrl: 'https://api.example.com' } })
    })

    it('routes NUXT_PUBLIC_* to public namespace', () => {
      const result = transformEnvVars([{ key: 'NUXT_PUBLIC_BASE_URL', value: 'https://example.com' }])
      expect(result).toEqual({ public: { baseUrl: 'https://example.com' } })
    })

    it('merges multiple public vars', () => {
      const result = transformEnvVars([
        { key: 'PUBLIC_API_URL', value: 'https://api.example.com' },
        { key: 'NUXT_PUBLIC_BASE_URL', value: 'https://example.com' },
      ])
      expect(result).toEqual({ public: { apiUrl: 'https://api.example.com', baseUrl: 'https://example.com' } })
    })
  })

  describe('prefix grouping (2+ keys)', () => {
    it('groups keys with same prefix into nested object', () => {
      const result = transformEnvVars([
        { key: 'GITHUB_CLIENT_ID', value: 'client123' },
        { key: 'GITHUB_CLIENT_SECRET', value: 'secret456' },
      ])
      expect(result).toEqual({ github: { clientId: 'client123', clientSecret: 'secret456' } })
    })

    it('does not group single-occurrence prefix', () => {
      const result = transformEnvVars([
        { key: 'GITHUB_CLIENT_ID', value: 'client123' },
        { key: 'DATABASE_URL', value: 'postgres://localhost' },
      ])
      expect(result).toEqual({ githubClientId: 'client123', databaseUrl: 'postgres://localhost' })
    })

    it('flattens public vars with same prefix (no sub-grouping)', () => {
      // Note: current implementation doesn't group within public namespace by sub-prefix
      const result = transformEnvVars([
        { key: 'PUBLIC_STRIPE_KEY', value: 'pk_test' },
        { key: 'PUBLIC_STRIPE_SECRET', value: 'sk_test' },
      ])
      expect(result).toEqual({ public: { stripeKey: 'pk_test', stripeSecret: 'sk_test' } })
    })

    it('handles mixed public and private with grouping', () => {
      const result = transformEnvVars([
        { key: 'GITHUB_CLIENT_ID', value: 'client123' },
        { key: 'GITHUB_CLIENT_SECRET', value: 'secret456' },
        { key: 'PUBLIC_API_URL', value: 'https://api.example.com' },
      ])
      expect(result).toEqual({
        github: { clientId: 'client123', clientSecret: 'secret456' },
        public: { apiUrl: 'https://api.example.com' },
      })
    })
  })

  describe('edge cases', () => {
    it('returns empty object for empty array', () => {
      const result = transformEnvVars([])
      expect(result).toEqual({})
    })

    it('handles special characters in values', () => {
      const result = transformEnvVars([{ key: 'DATABASE_URL', value: 'postgres://user:p@ss=word!@localhost:5432/db?ssl=true' }])
      expect(result).toEqual({ databaseUrl: 'postgres://user:p@ss=word!@localhost:5432/db?ssl=true' })
    })

    it('handles empty string values', () => {
      const result = transformEnvVars([{ key: 'EMPTY_VAR', value: '' }])
      expect(result).toEqual({ emptyVar: '' })
    })

    it('handles numeric string values', () => {
      const result = transformEnvVars([{ key: 'PORT', value: '3000' }])
      expect(result).toEqual({ port: '3000' })
    })

    it('handles JSON string values', () => {
      const result = transformEnvVars([{ key: 'CONFIG_JSON', value: '{"key": "value"}' }])
      expect(result).toEqual({ configJson: '{"key": "value"}' })
    })
  })

  describe('complex scenarios', () => {
    it('handles multiple prefix groups', () => {
      const result = transformEnvVars([
        { key: 'GITHUB_CLIENT_ID', value: 'gh_client' },
        { key: 'GITHUB_CLIENT_SECRET', value: 'gh_secret' },
        { key: 'GOOGLE_CLIENT_ID', value: 'goog_client' },
        { key: 'GOOGLE_CLIENT_SECRET', value: 'goog_secret' },
        { key: 'DATABASE_URL', value: 'postgres://localhost' },
      ])
      expect(result).toEqual({
        github: { clientId: 'gh_client', clientSecret: 'gh_secret' },
        google: { clientId: 'goog_client', clientSecret: 'goog_secret' },
        databaseUrl: 'postgres://localhost',
      })
    })

    it('handles public vars mixed with private (no sub-grouping in public)', () => {
      // Note: current implementation doesn't group within public namespace
      const result = transformEnvVars([
        { key: 'NUXT_PUBLIC_SENTRY_DSN', value: 'https://sentry.io' },
        { key: 'NUXT_PUBLIC_SENTRY_ENV', value: 'production' },
        { key: 'SENTRY_AUTH_TOKEN', value: 'auth_token' },
      ])
      expect(result).toEqual({
        public: { sentryDsn: 'https://sentry.io', sentryEnv: 'production' },
        sentryAuthToken: 'auth_token',
      })
    })
  })
})
