import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { number, object, optional, string } from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRuntimeValidationArtifacts, resolveValidationOptions } from '../src/validation'

const zodRuntimeConfigSchema = z.object({
  public: z.object({
    apiBase: z.string(),
  }),
  secretKey: z.string(),
})

const valibotRuntimeConfigSchema = object({
  public: object({
    apiBase: string(),
  }),
  secretKey: string(),
  port: optional(number()),
})

function cleanNuxtBuildOutputs(fixtureDir: string): void {
  rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
  rmSync(join(fixtureDir, '.output'), { recursive: true, force: true })
  rmSync(join(fixtureDir, 'node_modules/.cache/nuxt'), { recursive: true, force: true })
}

async function createRuntimeValidationTemplate($schema: Parameters<typeof resolveValidationOptions>[0]['$schema']) {
  const artifacts = await createRuntimeValidationArtifacts(
    resolveValidationOptions({ $schema, validateAtRuntime: true }),
    () => {},
  )

  expect(artifacts).not.toBeNull()

  return {
    draft: artifacts!.draft,
    onError: resolveValidationOptions({ $schema }).onError,
    schema: artifacts!.jsonSchema,
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

  it('validates with ArkType callable Standard Schema', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/arktype', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)

  it('does not validate during prepare', () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/validation-failure', import.meta.url))

    execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

    expect(existsSync(join(fixtureDir, '.nuxt'))).toBe(true)
  }, 30000)

  it('fails Nuxt build validation through the Nitro module', () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/validation-failure', import.meta.url))
    cleanNuxtBuildOutputs(fixtureDir)

    const result = spawnSync('pnpm', ['nuxi', 'build'], {
      cwd: fixtureDir,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('Runtime config validation failed')
  }, 60000)
})

describe('runtime JSON Schema generation', () => {
  it('builds a Nuxt app with Nitro-owned runtime validation artifacts', () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/runtime-invalid', import.meta.url))
    cleanNuxtBuildOutputs(fixtureDir)

    execSync('pnpm nuxi build', { cwd: fixtureDir, stdio: 'pipe' })

    expect(existsSync(join(fixtureDir, '.output/server/index.mjs'))).toBe(true)
  }, 60000)

  it('generates runtime validation template (Zod native)', async () => {
    const { draft, onError, schema } = await createRuntimeValidationTemplate(zodRuntimeConfigSchema)

    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect(schema.properties).toHaveProperty('secretKey')
    expect(schema.properties).toHaveProperty('public')
    expect(draft).toBe('2020-12')
    expect(onError).toBe('throw')
  }, 30000)

  it('generates runtime validation template (Valibot fallback)', async () => {
    const { draft, onError, schema } = await createRuntimeValidationTemplate(valibotRuntimeConfigSchema)

    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    expect(draft).toBe('7')
    expect(onError).toBe('throw')
  }, 30000)

  it('zod native JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const { draft, schema } = await createRuntimeValidationTemplate(zodRuntimeConfigSchema)

    const validator = new Validator(schema, draft as any)
    const validConfig = { secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(validConfig).valid).toBe(true)
    const invalidConfig = { secretKey: 123, public: { apiBase: 'https://api.test.com' } }
    expect(validator.validate(invalidConfig).valid).toBe(false)
  }, 30000)

  it('valibot fallback JSON Schema validates correctly', async () => {
    const { Validator } = await import('@cfworker/json-schema')
    const { draft, schema } = await createRuntimeValidationTemplate(valibotRuntimeConfigSchema)

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
