import type { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const nitroBin = fileURLToPath(new URL('../node_modules/.bin/nitro', import.meta.url))

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function runNitroBuild(fixtureDir: string) {
  return spawnSync(nitroBin, ['build'], { cwd: fixtureDir, encoding: 'utf8', env: process.env })
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
  it.concurrent('validates build config and generates runtime validation files', () => {
    const fixtureDir = fixturePath('nitro-validation-success')
    const result = runNitroBuild(fixtureDir)

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(existsSync(join(fixtureDir, '.nitro/safe-runtime-config/validate.mjs'))).toBe(true)
    expect(existsSync(join(fixtureDir, '.nitro/types/safe-runtime-config.d.ts'))).toBe(true)

    const validateModule = readFileSync(join(fixtureDir, '.nitro/safe-runtime-config/validate.mjs'), 'utf8')
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

    const child = spawn('node', [join(fixtureDir, '.output/server/index.mjs')], {
      cwd: fixtureDir,
      env: { ...process.env, PORT: '48766' },
    })
    const output = await waitForOutputMatching(child, /Runtime validation failed/, 5000)

    expect(output).toContain('Runtime validation failed')
    expect(output).toContain('port')
  }, 60000)
})
