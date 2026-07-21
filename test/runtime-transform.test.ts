import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('./fixtures/runtime-transform', import.meta.url))
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

describe('runtime Standard Schema transformations', () => {
  it('preserves async schema output after string environment overrides', async () => {
    const build = spawnSync(process.execPath, [nuxtBin, 'build'], {
      cwd: fixtureDir,
      encoding: 'utf8',
    })
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

    const port = '48767'
    const child = spawn('node', [serverEntry], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        NUXT_PERF_TRACE_ENABLED: JSON.stringify('true'),
        NUXT_PUBLIC_FEATURE_ENABLED: JSON.stringify('true'),
        PORT: port,
      },
    })
    children.push(child)

    const response = await waitForResponse(`http://127.0.0.1:${port}/api/config`, child)
    await expect(response.json()).resolves.toEqual({
      inputType: 'string',
      publicEnabled: true,
      rawPublicType: 'string',
      runtimeAppBaseURL: '/',
      safeEnabled: true,
      safeHasApp: false,
      validationRuns: 1,
    })

    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    expect(html).toContain('<div>boolean</div>')
    expect(html).toContain('featureEnabled:true')
    expect(html).toContain('moduleConfig:keep:1')
  }, 60000)
})
