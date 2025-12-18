import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('build-time validation', () => {
  it('validates successfully with valid hardcoded config (Valibot)', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/validation-success', import.meta.url)),
    })
    // If setup completes without throwing, build-time validation passed
    expect(true).toBe(true)
  }, 30000)

  it('skips validation when no schema provided', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/no-config', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)

  it('validates after merging .env variables', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/env-var-validation', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)

  it('validates with Zod native JSON Schema (build-time)', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/zod-native', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)
})

describe('runtime JSON Schema generation', () => {
  it('generates valid JSON Schema file (Zod native)', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/zod-native', import.meta.url))
    await setup({ rootDir: fixtureDir })

    const schemaPath = join(fixtureDir, '.nuxt/safe-runtime-config/schema.json')
    expect(existsSync(schemaPath)).toBe(true)

    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect(schema.properties).toHaveProperty('secretKey')
    expect(schema.properties).toHaveProperty('public')
  }, 30000)

  it('generates valid JSON Schema file (Valibot fallback)', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))
    await setup({ rootDir: fixtureDir })

    const schemaPath = join(fixtureDir, '.nuxt/safe-runtime-config/schema.json')
    expect(existsSync(schemaPath)).toBe(true)

    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
  }, 30000)

  it('zod native JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const fixtureDir = fileURLToPath(new URL('./fixtures/zod-native', import.meta.url))
    await setup({ rootDir: fixtureDir })

    const schemaPath = join(fixtureDir, '.nuxt/safe-runtime-config/schema.json')
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
    const validator = new Validator(schema, '2020-12')

    // Valid config should pass
    const validConfig = { secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(validConfig).valid).toBe(true)

    // Invalid config should fail
    const invalidConfig = { secretKey: 123, public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(invalidConfig).valid).toBe(false)
  }, 30000)

  it('valibot fallback JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))
    await setup({ rootDir: fixtureDir })

    const schemaPath = join(fixtureDir, '.nuxt/safe-runtime-config/schema.json')
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
    const validator = new Validator(schema)

    // Valid config should pass
    const validConfig = { secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(validConfig).valid).toBe(true)
  }, 30000)
})

describe('runtime validation with env override', () => {
  it('fails when env var overrides with invalid type', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))

    // Build the fixture
    execSync('pnpm nuxi build', { cwd: fixtureDir, stdio: 'pipe' })

    // Run server with invalid env var and capture output
    const output = await new Promise<string>((resolve) => {
      let stderr = ''
      const serverPath = join(fixtureDir, '.output/server/index.mjs')
      const child = spawn('node', [serverPath], {
        cwd: fixtureDir,
        env: { ...process.env, NUXT_PORT: 'not-a-number' },
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      child.stdout.on('data', (data) => {
        stderr += data.toString()
      })

      setTimeout(() => {
        child.kill()
        resolve(stderr)
      }, 3000)
    })

    expect(output).toContain('Runtime validation failed')
    expect(output).toContain('port')
  }, 60000)
})
