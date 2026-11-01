import type { Server } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getFreePort } from './utils/free-port'

const nuxtBin = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const children: ReturnType<typeof spawn>[] = []
let shelve: Server
let shelveUrl: string

// Answers slowly, so a server that does not wait for the fetch validates without the secrets.
function startMockShelve(port: string): Promise<Server> {
  const routes: Record<string, unknown> = {
    '/api/teams/team/projects/name/app': { id: 1, name: 'app' },
    '/api/teams/team/environments/production': { id: 2, name: 'production' },
    '/api/teams/team/projects/1/variables/env/2': [
      { key: 'DATABASE_URL', value: 'postgresql://shelve' },
      { key: 'GITHUB_CLIENT_ID', value: 'shelve-client' },
      { key: 'GITHUB_CLIENT_SECRET', value: 'shelve-secret' },
    ],
  }
  const server = createServer((request, response) => {
    const body = routes[request.url!]
    if (!body || request.headers.cookie !== 'authToken=test-token') {
      response.statusCode = body ? 401 : 404
      response.end()
      return
    }
    setTimeout(() => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(body))
    }, 300)
  })
  return new Promise(resolve => server.listen(Number(port), '127.0.0.1', () => resolve(server)))
}

function build(fixtureDir: string): void {
  // No token while building: runtime fetch must not need one, and ~/.shelve must not leak in.
  const { SHELVE_TOKEN: _token, ...env } = process.env
  const result = spawnSync(process.execPath, [nuxtBin, 'build'], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: { ...env, HOME: mkdtempSync(join(tmpdir(), 'shelve-home-')), SHELVE_URL: shelveUrl },
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

async function start(fixtureDir: string): Promise<{ port: string, child: ReturnType<typeof spawn> }> {
  const port = await getFreePort()
  const child = spawn('node', [join(fixtureDir, '.output/server/index.mjs')], {
    cwd: fixtureDir,
    env: { ...process.env, SHELVE_TOKEN: 'test-token', PORT: port },
  })
  children.push(child)
  return { port, child }
}

async function waitForJson(url: string, child: ReturnType<typeof spawn>): Promise<unknown> {
  let logs = ''
  child.stdout?.on('data', chunk => logs += chunk.toString())
  child.stderr?.on('data', chunk => logs += chunk.toString())

  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return await response.json()
    }
    catch {}
    if (child.exitCode !== null)
      throw new Error(`Server exited with code ${child.exitCode}\n${logs}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Server did not respond at ${url}\n${logs}`)
}

beforeAll(async () => {
  const port = await getFreePort()
  shelve = await startMockShelve(port)
  shelveUrl = `http://127.0.0.1:${port}`
})

afterEach(() => {
  for (const child of children)
    child.kill()
  children.length = 0
})

afterAll(() => new Promise<void>(resolve => shelve.close(() => resolve())))

describe('shelve runtime fetch', () => {
  it('validates the fetched secrets before serving requests', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/shelve-runtime', import.meta.url))
    build(fixtureDir)
    const { port, child } = await start(fixtureDir)

    await expect(waitForJson(`http://127.0.0.1:${port}/api/config`, child)).resolves.toEqual({
      databaseUrl: 'postgresql://shelve',
      github: { clientId: 'shelve-client', clientSecret: 'shelve-secret' },
      startupDatabaseUrl: 'postgresql://shelve',
      rawDatabaseUrl: 'postgresql://shelve',
    })
  }, 120000)

  it('merges the secrets into request configs without runtime validation', async () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/shelve-runtime-unvalidated', import.meta.url))
    build(fixtureDir)
    const { port, child } = await start(fixtureDir)

    await expect(waitForJson(`http://127.0.0.1:${port}/api/config`, child)).resolves.toEqual({
      databaseUrl: 'postgresql://shelve',
    })
  }, 120000)
})
