import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Validator } from '@cfworker/json-schema'
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

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function cleanNuxtBuildOutputs(fixtureDir: string): void {
  rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
  rmSync(join(fixtureDir, '.output'), { recursive: true, force: true })
  rmSync(join(fixtureDir, 'node_modules/.cache/nuxt'), { recursive: true, force: true })
}

function buildNuxt(fixtureDir: string) {
  cleanNuxtBuildOutputs(fixtureDir)
  const result = spawnSync('pnpm', ['nuxi', 'build'], { cwd: fixtureDir, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

describe('build-time validation', () => {
  it('sets up without a schema', () => {
    const fixtureDir = fixturePath('no-config')

    execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

    expect(existsSync(join(fixtureDir, '.nuxt'))).toBe(true)
  }, 30000)

  it('does not validate during prepare', () => {
    const fixtureDir = fixturePath('validation-failure')

    execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

    expect(existsSync(join(fixtureDir, '.nuxt'))).toBe(true)
  }, 30000)

  it('fails Nuxt build validation through the Nitro module', () => {
    const { status, output } = buildNuxt(fixturePath('validation-failure'))

    expect(status).not.toBe(0)
    expect(output).toContain('Runtime config validation failed')
    // The wrong port fails the build; the missing values are left to the server start check.
    const issues = output.slice(output.indexOf('Validation failed!'), output.indexOf('Error: Runtime config validation failed'))
    expect(issues).toContain('1. port: ')
    expect(issues).not.toMatch(/databaseUrl|secretKey|apiBase/)
  }, 60000)
})

describe('runtime JSON Schema generation', () => {
  it('types transformed output only when runtime validation applies it', async () => {
    const options = await resolveValidationOptions({
      $schema: './fixtures/runtime-transform/schema',
    }, fileURLToPath(new URL('.', import.meta.url)))

    const runtime = await createRuntimeValidationArtifacts(options, () => {})
    const buildOnly = await createRuntimeValidationArtifacts({ ...options, runtimeCheck: false }, () => {})

    expect(runtime!.typeDeclaration).toContain('StandardSchemaV1.InferOutput<typeof schema>')
    expect(buildOnly!.typeDeclaration).toContain('StandardSchemaV1.InferInput<typeof schema>')
  })

  it('builds a Nuxt app with Nitro-owned runtime validation artifacts', () => {
    const fixtureDir = fixturePath('runtime-invalid')
    const { status, output } = buildNuxt(fixtureDir)
    expect(status, output).toBe(0)

    const serverEntry = join(fixtureDir, '.output/server/index.mjs')
    const nitroChunk = join(fixtureDir, '.output/server/chunks/nitro/nitro.mjs')
    const serverOutput = `${readFileSync(serverEntry, 'utf-8')}\n${readFileSync(nitroChunk, 'utf-8')}`
    expect(serverOutput).not.toContain('nitropack/runtime')
    expect(serverOutput).not.toContain('#nitro-internal-virtual')
  }, 60000)

  it.each([
    ['Zod native', zodRuntimeConfigSchema, '2020-12'],
    ['Valibot fallback', valibotRuntimeConfigSchema, '7'],
  ] as const)('emits a %s JSON Schema with a matching draft', async (_name, $schema, expectedDraft) => {
    const options = await resolveValidationOptions({ $schema })
    const { draft, jsonSchema } = (await createRuntimeValidationArtifacts(options, () => {}))!
    const validator = new Validator(jsonSchema, draft)

    expect(options.onError).toBe('throw')
    expect(draft).toBe(expectedDraft)
    expect(validator.validate({ secretKey: 'test-key', public: { apiBase: 'https://api.test.com' } }).valid).toBe(true)
    expect(validator.validate({ secretKey: 123, public: { apiBase: 'https://api.test.com' } }).valid).toBe(false)
  })

  it('registers typed useSafeRuntimeConfig in server context', () => {
    const fixtureDir = fixturePath('server-typing')

    execSync('pnpm nuxi prepare', { cwd: fixtureDir, stdio: 'pipe' })

    const nitroImports = readFileSync(join(fixtureDir, '.nuxt/types/nitro-imports.d.ts'), 'utf-8')
    expect(nitroImports).toContain('useSafeRuntimeConfig')

    execSync('pnpm exec vue-tsc --noEmit --skipLibCheck -p .nuxt/tsconfig.server.json', {
      cwd: fixtureDir,
      stdio: 'pipe',
    })
  }, 60000)
})
