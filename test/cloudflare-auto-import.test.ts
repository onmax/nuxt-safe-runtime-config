import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory())
      out.push(...listFiles(p))
    else
      out.push(p)
  }
  return out
}

describe('cloudflare preset auto-imports', () => {
  it('does not leave useSafeRuntimeConfig as an unresolved global', () => {
    const fixtureDir = fileURLToPath(new URL('./fixtures/cloudflare-auto-import', import.meta.url))
    execSync('pnpm nuxi build', { cwd: fixtureDir, stdio: 'pipe' })

    const serverDir = join(fixtureDir, '.output/server')
    expect(existsSync(serverDir)).toBe(true)

    const failing: string[] = []
    for (const file of listFiles(serverDir).filter(f => f.endsWith('.mjs'))) {
      const src = readFileSync(file, 'utf-8')
      if (!src.includes('useSafeRuntimeConfig('))
        continue

      const hasBinding = (
        /\bfunction\s+useSafeRuntimeConfig\b/.test(src)
        || /\b(?:const|let|var)\s+useSafeRuntimeConfig\b/.test(src)
        || (src.includes('import') && src.includes('useSafeRuntimeConfig'))
      )

      if (!hasBinding)
        failing.push(file)
    }

    expect(failing).toEqual([])
  }, 120000)
})
