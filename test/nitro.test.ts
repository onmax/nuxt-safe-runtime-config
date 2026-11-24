import type { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import SafeRuntimeConfig, { resolveRuntimeConfigImport } from '../src/nitro'
import { runtimeConfigSchema } from './fixtures/_shared/nitro-runtime-config-schema'
import { getFreePort } from './utils/free-port'

const nitroBin = fileURLToPath(new URL('../node_modules/.bin/nitro', import.meta.url))
const rootRequire = createRequire(import.meta.url)

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function runNitroBuild(fixtureDir: string) {
  return spawnSync(nitroBin, ['build'], { cwd: fixtureDir, encoding: 'utf8', env: process.env })
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find(path => existsSync(path))
}

function waitForOutputMatching(child: ReturnType<typeof spawn>, pattern: RegExp, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let logs = ''
    const finish = () => {
      child.kill()
      resolve(logs)
    }
    const onData = (data: Buffer) => {
      logs += data.toString()
      if (pattern.test(logs))
        finish()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', () => resolve(logs))
    setTimeout(finish, timeoutMs)
  })
}

describe('nitro module', () => {
  it('resolves version-specific runtime config entries through ESM exports', () => {
    const nitro2RuntimeConfig = resolveRuntimeConfigImport(2, rootRequire.resolve('nuxt/package.json'))
    const nitro3RuntimeConfig = resolveRuntimeConfigImport(3, rootRequire.resolve('nitro/package.json'))

    expect(nitro2RuntimeConfig).toMatch(/nitropack[/\\]dist[/\\]runtime[/\\]config\.mjs$/)
    expect(nitro3RuntimeConfig).toMatch(/nitro[/\\]dist[/\\]runtime[/\\]runtime-config\.mjs$/)
  })

  it.each([
    ['Nitro 2', undefined, 'rollup:before'],
    ['Nitro 3 beta', { majorVersion: 3, version: '3.0.260429-beta' }, 'rollup:before'],
    ['Nitro 3 RC', { majorVersion: 3, version: '3.0.261103-rc' }, 'build:config'],
  ] as const)('regenerates validation files after output cleanup on %s', async (_name, meta, hook) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'safe-runtime-config-'))
    const outputDir = join(rootDir, '.output')
    const buildDir = join(outputDir, '.build')
    const hooks = new Map<string, () => Promise<void>>()
    const validateModule = join(buildDir, 'safe-runtime-config/validate.mjs')
    try {
      await SafeRuntimeConfig.setup({
        meta,
        options: {
          rootDir,
          buildDir,
          safeRuntimeConfig: { $schema: runtimeConfigSchema, buildCheck: 'off', runtimeCheck: false },
        },
        hooks: { hook: (name: string, callback: () => Promise<void>) => hooks.set(name, callback) },
      })

      expect([...hooks.keys()]).toEqual([hook])
      expect(existsSync(validateModule)).toBe(true)
      await rm(outputDir, { recursive: true })
      await hooks.get(hook)!()
      expect(readFileSync(validateModule, 'utf8')).toContain('export const schema')
    }
    finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it.concurrent('validates build config and generates runtime validation files', () => {
    const fixtureDir = fixturePath('nitro-validation-success')
    const result = runNitroBuild(fixtureDir)

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('rollup:before')
    const validateModulePath = firstExisting([
      join(fixtureDir, '.nitro/safe-runtime-config/validate.mjs'),
      join(fixtureDir, 'node_modules/.nitro/safe-runtime-config/validate.mjs'),
    ])
    const typeDeclarationPath = firstExisting([
      join(fixtureDir, '.nitro/types/safe-runtime-config.d.ts'),
      join(fixtureDir, 'node_modules/.nitro/types/safe-runtime-config.d.ts'),
    ])

    expect(validateModulePath).toBeDefined()
    expect(typeDeclarationPath).toBeDefined()

    const validateModule = readFileSync(validateModulePath!, 'utf8')
    expect(validateModule).toContain('export const schema')
    expect(validateModule).toContain('export const onError')
  }, 60000)

  it.concurrent('fails during build when runtime config does not match the schema', () => {
    const fixtureDir = fixturePath('nitro-validation-failure')
    const result = runNitroBuild(fixtureDir)

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('Runtime config validation failed')
  }, 60000)

  it.concurrent('fails at runtime when runtime validation is enabled', async () => {
    const fixtureDir = fixturePath('nitro-runtime-invalid')
    const build = runNitroBuild(fixtureDir)
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
    expect(`${build.stdout}\n${build.stderr}`).not.toContain('rollup:before')

    const child = spawn('node', [join(fixtureDir, '.output/server/index.mjs')], {
      cwd: fixtureDir,
      env: { ...process.env, PORT: await getFreePort() },
    })
    const output = await waitForOutputMatching(child, /Runtime validation failed/, 5000)

    expect(output).toContain('Runtime validation failed')
    expect(output).toContain('port')

    // Nitro 3 passes env overrides as raw strings; NITRO_PORT also sets the listen port.
    const port = await getFreePort()
    const coerced = spawn('node', [join(fixtureDir, '.output/server/index.mjs')], {
      cwd: fixtureDir,
      env: { ...process.env, NITRO_PORT: port },
    })
    let coercedOutput = ''
    coerced.stdout?.on('data', (data: Buffer) => coercedOutput += data.toString())
    coerced.stderr?.on('data', (data: Buffer) => coercedOutput += data.toString())
    let body: unknown
    for (let attempt = 0; attempt < 100 && body === undefined && coerced.exitCode === null; attempt++) {
      body = await fetch(`http://127.0.0.1:${port}/port`).then(response => response.json(), () => undefined)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    coerced.kill()

    expect(coercedOutput).not.toContain('Runtime validation failed')
    // The validated value is written back into Nitro 3's mutable shared config, before the app's own plugins run.
    expect(body, coercedOutput).toEqual({ port: Number(port), type: 'number', typeInPlugin: 'number' })
  }, 60000)
})
