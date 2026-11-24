import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { nitroMajor } from '../../src/migrate/project'
import { createReport } from '../../src/migrate/report'
import { migrateSource } from '../../src/migrate/source'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nsrc-nitro-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

const nuxt = { dependencies: { nuxt: '^4.7.0' } }

describe('nitroMajor', () => {
  it('reads the app\'s own nitro or nitropack dependency first', () => {
    expect(nitroMajor(tree({}), { dependencies: { nitro: '^3.0.0' } })).toBe(3)
    expect(nitroMajor(tree({}), { devDependencies: { nitropack: '^2.13.0' } })).toBe(2)
    expect(nitroMajor(tree({}), nuxt)).toBe(2)
  })

  it('is unknown when a package.json above the app declares nitro', () => {
    const nested = tree({
      'package.json': { workspaces: ['packages/*'] },
      'packages/package.json': { workspaces: ['web'], devDependencies: { nitro: '^3.0.0' } },
      'packages/web/package.json': nuxt,
    })
    expect(nitroMajor(join(nested, 'packages/web'), nuxt)).toBeUndefined()
    expect(nitroMajor(join(nested, 'packages/web'), { dependencies: { nuxt: '^4.7.0', nitropack: '^2.13.0' } })).toBe(2)
    const plain = tree({ 'pnpm-workspace.yaml': 'packages: [apps/*]\n', 'package.json': { devDependencies: { typescript: '^5.0.0' } }, 'apps/web/package.json': nuxt })
    expect(nitroMajor(join(plain, 'apps/web'), nuxt)).toBe(2)
  })
})

describe('event argument', () => {
  const migrate = (code: string): string => migrateSource('server/api/config.get.ts', code, createReport(), { eventArgument: true })

  it('passes the event in handlers from the auto-import, h3 and Nitro 2', () => {
    expect(migrate('export default defineEventHandler(event => useSafeRuntimeConfig().apiKey)\n'))
      .toBe('export default defineEventHandler(event => useRuntimeConfig(event).apiKey)\n')
    expect(migrate('import { defineEventHandler as handler } from \'h3\'\n\nexport default handler(event => useSafeRuntimeConfig().apiKey)\n'))
      .toBe('import { defineEventHandler as handler } from \'h3\'\n\nexport default handler(event => useRuntimeConfig(event).apiKey)\n')
  })

  it('leaves the call without arguments when the factory comes from elsewhere', () => {
    for (const source of ['./domain', 'nuxt/server']) {
      const code = `import { defineEventHandler } from '${source}'\n\nexport default defineEventHandler(id => useSafeRuntimeConfig().apiKey)\n`
      expect(migrate(code)).toBe(code.replace('useSafeRuntimeConfig()', 'useRuntimeConfig()'))
    }
  })
})
