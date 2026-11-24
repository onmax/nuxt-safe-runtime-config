import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getFreePort } from './utils/free-port'
import { waitForResponse } from './utils/server'

const cwd = process.env.NUXT_47_TEST_APP
const server = '.output/server/index.mjs'

function build(env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(join(cwd!, 'node_modules/.bin/nuxt'), ['build'], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 90000,
  })
  expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0)
}

function expectStartupFailure(env: NodeJS.ProcessEnv, error: RegExp) {
  const result = spawnSync(process.execPath, [server], {
    cwd,
    env: { ...process.env, ...env, NITRO_PORT: '0' },
    encoding: 'utf8',
    timeout: 5000,
  })
  const output = `${result.stdout}\n${result.stderr}`
  expect(result.status, output).toBe(1)
  expect(output).toMatch(error)
}

async function expectValidOverride(env: NodeJS.ProcessEnv, expected: object) {
  const port = await getFreePort()
  const child = spawn(process.execPath, [server], {
    cwd,
    env: { ...process.env, HOST: '127.0.0.1', NITRO_PORT: port, ...env },
  })
  let stderr = ''
  child.stderr.on('data', chunk => stderr += chunk.toString())
  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/api/quota`, child)
    expect(await response.json()).toMatchObject(expected)
    expect(stderr).not.toContain('NUXT_E8014')
  }
  finally {
    child.kill()
  }
}

describe.skipIf(!cwd)('startup on Nuxt 4.7 with Nitro 3', () => {
  it('validates module-owned overrides without taking over app schemas', async () => {
    build()
    expectStartupFailure({ NUXT_QUOTA: 'abc' }, /safe-runtime-config[\s\S]*quota/)
    expectStartupFailure({ NUXT_PUBLIC_LIMITS_QUOTA: 'abc' }, /safe-runtime-config[\s\S]*quota/)
    expectStartupFailure({ NUXT_APP_LIMIT: 'abc' }, /NUXT_E8014[\s\S]*app[_ -]?limit/i)
    await expectValidOverride(
      { NUXT_QUOTA: '8080', NUXT_API_VERSION: '2.10', NUXT_PUBLIC_LIMITS_QUOTA: '8080', NUXT_UNRELATED_ENABLED: 'on' },
      { quota: 8080, apiVersion: '2.10', limits: { quota: 8080 }, unrelatedEnabled: true },
    )
  }, 110000)

  it('passes valid envSchema overrides through without a Nuxt warning', async () => {
    build({ TEST_ENV_SCHEMA: '1' })
    await expectValidOverride({ NUXT_QUOTA: '8080' }, { quota: 8080 })
  }, 100000)
})
