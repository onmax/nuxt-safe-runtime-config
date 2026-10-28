import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as ports from './utils/free-port'

const labDir = fileURLToPath(new URL('../labs/env-schema', import.meta.url))
const nuxtBin = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const vueTscBin = fileURLToPath(new URL('../node_modules/vue-tsc/bin/vue-tsc.js', import.meta.url))
const serverEntry = join(labDir, '.output/server/index.mjs')
const exampleMarkers = ['LAB_EXAMPLE_SECRET_NEVER_A_DEFAULT', 'LAB_EXAMPLE_PIN_NEVER_A_DEFAULT']
const firstSecret = 'lab-first-deployment-secret-129'
const secondSecret = 'lab-second-deployment-secret-longer-247'
const inheritedBuildSecret = 'lab-build-secret-must-not-be-bundled-369'

interface RunningProcess {
  child: ChildProcess
  closed: Promise<{ code: number | null, signal: NodeJS.Signals | null }>
  logs: () => string
}

const children = new Set<RunningProcess>()
let builtEntryDigest = ''

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('NUXT_') || key.startsWith('NITRO_') || ['HOST', 'PORT', 'NODE_ENV'].includes(key))
      delete env[key]
  }
  return { ...env, CI: 'true', NODE_ENV: 'production', NUXT_TELEMETRY_DISABLED: '1' }
}

function launch(args: string[], env: NodeJS.ProcessEnv): RunningProcess {
  const child = spawn(process.execPath, args, { cwd: labDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', chunk => output = (output + chunk.toString()).slice(-1_000_000))
  child.stderr?.on('data', chunk => output = (output + chunk.toString()).slice(-1_000_000))
  const closed = new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const running = { child, closed, logs: () => output }
  children.add(running)
  return running
}

async function within<T>(operation: Promise<T>, milliseconds: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message())), milliseconds)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function stop(running: RunningProcess): Promise<void> {
  try {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGTERM')
      try {
        await within(running.closed, 3000, () => 'Server did not stop after SIGTERM')
      }
      catch {
        running.child.kill('SIGKILL')
      }
    }
    await within(running.closed, 3000, () => 'Child process did not close')
  }
  finally {
    children.delete(running)
  }
}

async function runCommand(args: string[], timeout: number, overrides: NodeJS.ProcessEnv = {}): Promise<void> {
  const running = launch(args, { ...cleanEnvironment(), ...overrides })
  try {
    const result = await within(running.closed, timeout, () => `Lab command timed out\n${running.logs()}`)
    expect(result.code, running.logs()).toBe(0)
  }
  finally {
    await stop(running)
  }
}

function deploymentEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = {
    ...cleanEnvironment(),
    NUXT_API_SECRET: firstSecret,
    NUXT_ACCOUNT_PIN: '1e3',
    NUXT_RETRIES: '3',
    ...overrides,
  }
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

async function startServer(overrides: NodeJS.ProcessEnv = {}) {
  // Nitro 2 maps PORT=0 to its default port, so retry bind collisions instead.
  for (let attempt = 0; ; attempt++) {
    const port = await ports.getFreePort()
    const running = launch([serverEntry], { ...deploymentEnvironment(overrides), HOST: '127.0.0.1', PORT: port })
    try {
      await within((async () => {
        while (running.child.exitCode === null && running.child.signalCode === null
          && !/Listening on|EADDRINUSE/.test(running.logs())) {
          await delay(25)
        }
        if (running.child.exitCode !== null || running.child.signalCode !== null)
          await running.closed
      })(), 12_000, () => `Lab server did not start\n${running.logs()}`)
      if (!running.logs().includes('EADDRINUSE'))
        return Object.assign(running, { url: `http://127.0.0.1:${port}` })
      if (attempt >= 2)
        throw new Error(`Lab server could not bind after three attempts\n${running.logs()}`)
    }
    catch (error) {
      await stop(running)
      throw error
    }
    await stop(running)
  }
}

async function ready(server: Awaited<ReturnType<typeof startServer>>): Promise<Response> {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null)
      throw new Error(`Lab server exited before readiness\n${server.logs()}`)
    try {
      const response = await fetch(`${server.url}/api/config`, { signal: AbortSignal.timeout(1000) })
      if (response.ok)
        return response
      await response.body?.cancel()
    }
    catch {}
    await delay(75)
  }
  throw new Error(`Lab server did not become ready\n${server.logs()}`)
}

async function outputText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const text: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      text.push(await outputText(path))
    else
      text.push(await readFile(path, 'utf8'))
  }
  return text.join('\n')
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

beforeAll(async () => {
  await expect(access(join(labDir, '.env'))).rejects.toMatchObject({ code: 'ENOENT' })
  await runCommand([nuxtBin, 'prepare'], 60_000)
  const declaration = await readFile(join(labDir, '.nuxt/types/safe-runtime-config.d.ts'), 'utf8')
  expect(declaration).toContain('optionalLimit?: number')
  expect(declaration).toContain('logLevel: "debug" | "info" | "warn" | "error"')
  await runCommand([vueTscBin, '--noEmit', '--skipLibCheck', '-p', '.nuxt/tsconfig.server.json'], 60_000)
  await runCommand([nuxtBin, 'build'], 120_000)
  builtEntryDigest = digest(await readFile(serverEntry))
}, 250_000)

afterAll(async () => {
  await Promise.all([...children].map(stop))
}, 10_000)

describe('env schema deployment lab', () => {
  it('retries startup when another process claims the selected port', async () => {
    const occupied = createServer(socket => socket.destroy())
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(0, '127.0.0.1', resolve)
    })
    const port = String((occupied.address() as AddressInfo).port)
    const getFreePort = vi.spyOn(ports, 'getFreePort').mockResolvedValueOnce(port)
    try {
      const server = await startServer()
      try {
        const response = await ready(server)
        await response.body?.cancel()
        expect(getFreePort).toHaveBeenCalledTimes(2)
        expect(new URL(server.url).port).not.toBe(port)
      }
      finally {
        await stop(server)
      }
    }
    finally {
      getFreePort.mockRestore()
      await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()))
    }
  }, 20_000)

  it('builds without deployment values and never embeds example credentials', async () => {
    const builtText = await outputText(join(labDir, '.output'))
    for (const marker of [...exampleMarkers, firstSecret, secondSecret])
      expect(builtText).not.toContain(marker)
    const clientText = await outputText(join(labDir, '.output/public'))
    for (const name of ['apiSecret', 'accountPin', 'optionalLimit', 'NUXT_API_SECRET', 'NUXT_ACCOUNT_PIN'])
      expect(clientText).not.toContain(name)
  })

  it('serves parsed public values and exact private strings from event and global config', async () => {
    const server = await startServer({
      NUXT_OPTIONAL_LIMIT: '',
      NUXT_PUBLIC_REPLAY_ENABLED: 'true',
      NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE: '0.4',
      NUXT_PUBLIC_LOG_LEVEL: 'debug',
      NUXT_PUBLIC_API_BASE: 'https://first.example.test/api',
      NUXT_PUBLIC_DISPLAY_LABEL: 'First deployment',
    })
    try {
      const response = await ready(server)
      const config: unknown = await response.json()
      expect(config).toEqual({
        secretLength: firstSecret.length,
        secretDigest: digest(firstSecret),
        accountPin: '1e3',
        retries: 3,
        roles: ['read'],
        settings: { enabled: false, retries: 3, tags: [] },
        public: {
          replayEnabled: true,
          telemetry: { sampleRate: 0.4 },
          logLevel: 'debug',
          apiBase: 'https://first.example.test/api',
          displayLabel: 'First deployment',
        },
        types: { accountPin: 'string', retries: 'number', optionalLimit: 'undefined', replayEnabled: 'boolean', sampleRate: 'number' },
        matchesStartup: true,
      })
      const html = await (await fetch(server.url, { signal: AbortSignal.timeout(3000) })).text()
      expect(html).toContain('<p>replay:boolean:true</p>')
      expect(html).toContain('<p>sample:number:0.4</p>')
      expect(html).toContain('<p>level:debug</p>')
      expect(html).toContain('First deployment')
      for (const privateValue of [firstSecret, 'apiSecret', 'accountPin', 'optionalLimit', ...exampleMarkers])
        expect(html).not.toContain(privateValue)
      expect(JSON.stringify(config)).not.toContain(firstSecret)
    }
    finally {
      await stop(server)
    }
  }, 20_000)

  it('restarts the same artifact with different credentials and typed values', async () => {
    const server = await startServer({
      NUXT_API_SECRET: secondSecret,
      NUXT_ACCOUNT_PIN: 'false',
      NUXT_RETRIES: '7',
      NUXT_OPTIONAL_LIMIT: '12',
      NUXT_PUBLIC_REPLAY_ENABLED: 'false',
      NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE: '0.8',
      NUXT_PUBLIC_LOG_LEVEL: 'warn',
      NUXT_PUBLIC_DISPLAY_LABEL: 'Second deployment',
    })
    try {
      const config: unknown = await (await ready(server)).json()
      expect(config).toMatchObject({
        secretLength: secondSecret.length,
        secretDigest: digest(secondSecret),
        accountPin: 'false',
        retries: 7,
        optionalLimit: 12,
        public: { replayEnabled: false, telemetry: { sampleRate: 0.8 }, logLevel: 'warn', displayLabel: 'Second deployment' },
        types: { accountPin: 'string', retries: 'number', optionalLimit: 'number', replayEnabled: 'boolean', sampleRate: 'number' },
        matchesStartup: true,
      })
      expect(digest(await readFile(serverEntry))).toBe(builtEntryDigest)
    }
    finally {
      await stop(server)
    }
  }, 20_000)

  it('uses declared public defaults while an absent optional value stays undefined', async () => {
    const server = await startServer()
    try {
      const config: unknown = await (await ready(server)).json()
      expect(config).toMatchObject({
        public: { replayEnabled: false, telemetry: { sampleRate: 0.1 }, logLevel: 'info', apiBase: 'https://example.test/api', displayLabel: 'Deployment lab' },
        types: { optionalLimit: 'undefined' },
        matchesStartup: true,
      })
      expect(config).not.toHaveProperty('optionalLimit')
    }
    finally {
      await stop(server)
    }
  }, 20_000)

  it('validates injected JSON arrays and objects in the built server', async () => {
    const server = await startServer({
      NUXT_ROLES: '["read","write"]',
      NUXT_SETTINGS: '{"enabled":true,"retries":7,"tags":["one","two"]}',
      NUXT_METADATA: '{"nested":[true,null,3]}',
    })
    try {
      const config: unknown = await (await ready(server)).json()
      expect(config).toMatchObject({
        roles: ['read', 'write'],
        settings: { enabled: true, retries: 7, tags: ['one', 'two'] },
        metadata: { nested: [true, null, 3] },
      })
    }
    finally { await stop(server) }
  }, 20_000)

  it.each([
    ['invalid JSON array item', 'NUXT_ROLES', '["unknown"]'],
    ['invalid JSON object property', 'NUXT_SETTINGS', '{"enabled":"true","retries":3,"tags":[]}'],
    ['missing JSON object property', 'NUXT_SETTINGS', '{"enabled":true,"retries":3}'],
    ['malformed JSON', 'NUXT_ROLES', '['],
    ['unsafe JSON object', 'NUXT_METADATA', '{"__proto__":{"polluted":true}}'],
    ['missing secret', 'NUXT_API_SECRET', undefined],
    ['short secret', 'NUXT_API_SECRET', 'short!'],
    ['missing required number', 'NUXT_RETRIES', undefined],
    ['invalid required number', 'NUXT_RETRIES', 'not-a-number'],
    ['empty required string', 'NUXT_ACCOUNT_PIN', ''],
    ['invalid optional number', 'NUXT_OPTIONAL_LIMIT', 'not-a-number'],
    ['invalid enum', 'NUXT_PUBLIC_LOG_LEVEL', 'trace'],
    ['out-of-range number', 'NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE', '1.1'],
    ['invalid URL', 'NUXT_PUBLIC_API_BASE', 'not-a-url'],
    ['invalid boolean', 'NUXT_PUBLIC_REPLAY_ENABLED', 'sometimes'],
    ['empty override of a real default', 'NUXT_PUBLIC_DISPLAY_LABEL', ''],
  ])('rejects %s before serving requests without logging private values', async (_, key, value) => {
    const server = await startServer({ [key]: value })
    try {
      const result = await within(server.closed, 12_000, () => `Invalid deployment did not stop\n${server.logs()}`)
      expect(result.code).not.toBe(0)
      expect(server.logs()).toContain('Runtime validation failed')
      expect(server.logs()).toContain(key)
      for (const secret of [firstSecret, secondSecret, 'short!', ...exampleMarkers])
        expect(server.logs()).not.toContain(secret)
    }
    finally {
      await stop(server)
    }
  }, 20_000)

  it('does not bundle inherited build credentials and accepts new runtime credentials', async () => {
    await runCommand([nuxtBin, 'build'], 120_000, { NUXT_API_SECRET: inheritedBuildSecret })
    const builtText = await outputText(join(labDir, '.output'))
    for (const marker of [inheritedBuildSecret, firstSecret, secondSecret, ...exampleMarkers])
      expect(builtText).not.toContain(marker)

    const server = await startServer({ NUXT_API_SECRET: secondSecret, NUXT_ACCOUNT_PIN: '00107' })
    try {
      const config: unknown = await (await ready(server)).json()
      expect(config).toMatchObject({ secretDigest: digest(secondSecret), accountPin: '00107', matchesStartup: true })
      const html = await (await fetch(server.url, { signal: AbortSignal.timeout(3000) })).text()
      for (const marker of [inheritedBuildSecret, secondSecret, ...exampleMarkers]) {
        expect(html).not.toContain(marker)
        expect(server.logs()).not.toContain(marker)
      }
    }
    finally {
      await stop(server)
    }
  }, 140_000)
})
