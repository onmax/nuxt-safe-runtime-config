import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('./fixtures/runtime-coercion', import.meta.url))
const nuxtBin = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const serverEntry = join(fixtureDir, '.output/server/index.mjs')
const children: ReturnType<typeof spawn>[] = []

afterEach(() => {
  for (const child of children)
    child.kill()
  children.length = 0
})

async function waitForResponse(url: string, child: ReturnType<typeof spawn>): Promise<Response> {
  let logs = ''
  child.stdout?.on('data', chunk => logs += chunk.toString())
  child.stderr?.on('data', chunk => logs += chunk.toString())

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return response
    }
    catch {}
    if (child.exitCode !== null)
      throw new Error(`Server exited with code ${child.exitCode}\n${logs}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Server did not respond at ${url}\n${logs}`)
}

describe('runtime env coercion with an inline schema', () => {
  it('serves coerced, event-scoped config on the server and in the client payload', async () => {
    const build = spawnSync(process.execPath, [nuxtBin, 'build'], { cwd: fixtureDir, encoding: 'utf8' })
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

    const port = '48768'
    const child = spawn('node', [serverEntry], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        NUXT_SECRET: 'runtime-secret',
        // Nitro 2 parses `1` into a number; quoted JSON stays a string, as on Nitro 3.
        NUXT_PERF_TRACE_ENABLED: '1',
        NUXT_PUBLIC_POSTHOG_ENABLED: JSON.stringify('true'),
        NUXT_PUBLIC_POSTHOG_SAMPLE_RATE: JSON.stringify('0.5'),
        NUXT_PUBLIC_LOGINS: JSON.stringify(JSON.stringify(['email', 'github'])),
        PORT: port,
      },
    })
    children.push(child)

    const response = await waitForResponse(`http://127.0.0.1:${port}/api/config`, child)
    await expect(response.json()).resolves.toEqual({
      secret: 'runtime-secret',
      perfTraceEnabled: true,
      posthogEnabled: true,
      sampleRate: 0.5,
      logins: ['email', 'github'],
      sameAsShared: true,
    })

    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    expect(html).toContain('<div>posthog:boolean:true</div>')
    expect(html).toContain('<div>rate:number</div>')
    expect(html).toMatch(/posthog:\{enabled:true,sampleRate:\.5\}/)
  }, 60000)

  it('fails at startup when a runtime value cannot be coerced', async () => {
    const child = spawn('node', [serverEntry], {
      cwd: fixtureDir,
      env: { ...process.env, NUXT_SECRET: 'runtime-secret', NUXT_PERF_TRACE_ENABLED: 'maybe', PORT: '48769' },
    })
    children.push(child)

    let logs = ''
    child.stdout?.on('data', chunk => logs += chunk.toString())
    child.stderr?.on('data', chunk => logs += chunk.toString())
    await new Promise(resolve => child.on('exit', resolve))

    expect(logs).toContain('Runtime validation failed')
    expect(logs).toContain('/perfTrace/enabled')
  }, 30000)
})
