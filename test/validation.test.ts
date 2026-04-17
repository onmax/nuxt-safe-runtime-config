import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

async function loadRuntimeValidationTemplate(fixtureDir: string) {
  rmSync(join(fixtureDir, '.nuxt/safe-runtime-config'), { recursive: true, force: true })
  execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

  const templatePath = join(fixtureDir, '.nuxt/safe-runtime-config/validate.mjs')
  const declarationPath = join(fixtureDir, '.nuxt/safe-runtime-config/validate.d.ts')

  expect(existsSync(templatePath)).toBe(true)
  expect(existsSync(declarationPath)).toBe(true)

  const template = await import(`${pathToFileURL(templatePath).href}?t=${Date.now()}-${Math.random()}`)

  return template as {
    schema: Record<string, any>
    onError: 'throw' | 'warn' | 'ignore'
    draft: string
  }
}

describe('build-time validation', () => {
  it('validates successfully with valid hardcoded config (Valibot)', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/validation-success', import.meta.url)),
    })
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
  it('generates runtime validation template (Zod native)', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/zod-native', import.meta.url))
    const { draft, onError, schema } = await loadRuntimeValidationTemplate(fixtureDir)

    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect(schema.properties).toHaveProperty('secretKey')
    expect(schema.properties).toHaveProperty('public')
    expect(draft).toBe('2020-12')
    expect(onError).toBe('throw')
  }, 30000)

  it('generates runtime validation template (Valibot fallback)', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))
    const { draft, onError, schema } = await loadRuntimeValidationTemplate(fixtureDir)

    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect(draft).toBe('7')
    expect(onError).toBe('throw')
  }, 30000)

  it('zod native JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const fixtureDir = fileURLToPath(new URL('./fixtures/zod-native', import.meta.url))
    const { draft, schema } = await loadRuntimeValidationTemplate(fixtureDir)

    const validator = new Validator(schema, draft as any)
    const validConfig = { secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(validConfig).valid).toBe(true)
    const invalidConfig = { secretKey: 123, public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(invalidConfig).valid).toBe(false)
  }, 30000)

  it('valibot fallback JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))
    const { draft, schema } = await loadRuntimeValidationTemplate(fixtureDir)

    const validator = new Validator(schema, draft as any)
    const validConfig = { secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(validConfig).valid).toBe(true)
    const invalidConfig = { secretKey: 123, public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(invalidConfig).valid).toBe(false)
  }, 30000)

  it('registers typed useSafeRuntimeConfig in server context', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/server-typing', import.meta.url))

    await setup({ rootDir: fixtureDir })
    execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

    const nitroImportsPath = join(fixtureDir, '.nuxt/types/nitro-imports.d.ts')
    expect(existsSync(nitroImportsPath)).toBe(true)

    const nitroImports = readFileSync(nitroImportsPath, 'utf-8')
    expect(nitroImports).toContain('useSafeRuntimeConfig')

    execSync('pnpm exec vue-tsc --noEmit --skipLibCheck -p .nuxt/tsconfig.server.json', {
      cwd: fixtureDir,
      stdio: 'pipe',
    })
  }, 60000)
})

describe('runtime validation with env override', () => {
  it('fails when env var overrides with invalid type', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/valibot-runtime', import.meta.url))
    execSync('pnpm nuxi build', { cwd: fixtureDir, stdio: 'pipe' })
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
