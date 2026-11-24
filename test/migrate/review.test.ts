import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { migrate } from '../../src/migrate'
import { dependencyVersion, meetsMinimum, migratePackageJson } from '../../src/migrate/project'
import { createReport } from '../../src/migrate/report'
import { analyseSchema } from '../../src/migrate/schema'

// These apps sit inside this repository, whose package.json declares `nitro`, so Nuxt would build them with Nitro 3.
// They stand for standalone apps on Nitro 2; nitro.test.ts covers the detection.
vi.mock('../../src/migrate/project', async importOriginal => ({ ...await importOriginal<typeof import('../../src/migrate/project')>(), nitroMajor: () => 2 }))

const here = fileURLToPath(new URL('.', import.meta.url))
const tmpRoot = join(here, '.tmp', 'review')
const outside: string[] = []

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  for (const dir of outside) rmSync(dir, { recursive: true, force: true })
})

/** Writes an app inside the repository, so zod and valibot resolve, with a stub nuxt 4.7.0. */
function app(name: string, files: Record<string, string>): string {
  const dir = join(tmpRoot, name)
  rmSync(dir, { recursive: true, force: true })
  write(dir, {
    'package.json': JSON.stringify({ name, private: true, dependencies: { 'nuxt': '^4.7.0', 'nuxt-safe-runtime-config': '^0.4.0', 'zod': '^4.6.7' } }, null, 2),
    'node_modules/nuxt/package.json': JSON.stringify({ name: 'nuxt', version: '4.7.0' }),
    ...files,
  })
  return dir
}

/** A directory outside the repository, where no node_modules is found up the tree. */
function outsideDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nsrc-review-'))
  outside.push(dir)
  write(dir, files)
  return dir
}

function write(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
}

const read = (dir: string, path: string): string => readFileSync(join(dir, path), 'utf8')

const zodConfig = `import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiSecret: '',
  },
  safeRuntimeConfig: {
    $schema: z.object({ apiSecret: z.string() }),
  },
})
`

describe('module aliases and layers', () => {
  it('rewrites #safe-runtime-config/server imports to the auto-imported useRuntimeConfig', async () => {
    const dir = app('server-alias', {
      'nuxt.config.ts': zodConfig,
      'server/api/plain.get.ts': `import { useSafeRuntimeConfig } from '#safe-runtime-config/server'

export default defineEventHandler(() => useSafeRuntimeConfig().apiSecret)
`,
      'server/api/aliased.get.ts': `import { useSafeRuntimeConfig as config } from '#safe-runtime-config/server'

export default defineEventHandler(() => config().apiSecret)
`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('migrated')
    expect(read(dir, 'server/api/plain.get.ts')).toBe(`export default defineEventHandler(() => useRuntimeConfig().apiSecret)\n`)
    expect(read(dir, 'server/api/aliased.get.ts')).toBe(`export default defineEventHandler(() => useRuntimeConfig().apiSecret)\n`)
  })

  it('renames #imports and nitro-runtime-config imports, and mockNuxtImport names', async () => {
    const dir = app('imports-alias', {
      'nuxt.config.ts': zodConfig,
      'app/composables/config.ts': `import { useSafeRuntimeConfig } from '#imports'\n\nexport const secret = () => useSafeRuntimeConfig().apiSecret\n`,
      'app/composables/both.ts': `import { useRuntimeConfig, useSafeRuntimeConfig } from '#imports'\n\nexport const both = () => [useRuntimeConfig(), useSafeRuntimeConfig()]\n`,
      'server/utils/nitro.ts': `import { useRuntimeConfig as nitroConfig } from '#safe-runtime-config/nitro-runtime-config'\n\nexport const read = () => nitroConfig().apiSecret\n`,
      'test/nuxt.test.ts': `mockNuxtImport('useSafeRuntimeConfig', () => () => config)\n`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('migrated')
    expect(read(dir, 'app/composables/config.ts')).toBe(`import { useRuntimeConfig } from '#imports'\n\nexport const secret = () => useRuntimeConfig().apiSecret\n`)
    expect(read(dir, 'app/composables/both.ts')).toBe(`import { useRuntimeConfig } from '#imports'\n\nexport const both = () => [useRuntimeConfig(), useRuntimeConfig()]\n`)
    expect(read(dir, 'server/utils/nitro.ts')).toBe(`export const read = () => useRuntimeConfig().apiSecret\n`)
    expect(read(dir, 'test/nuxt.test.ts')).toBe(`mockNuxtImport('useRuntimeConfig', () => () => config)\n`)
  })

  it('stops on imports of the module that have no Nuxt equivalent', async () => {
    for (const source of [`import type { ModuleOptions } from 'nuxt-safe-runtime-config'`, `import { schema } from '#safe-runtime-config/validate'`]) {
      const dir = app('module-import', {
        'nuxt.config.ts': zodConfig,
        'server/utils/types.ts': `${source}\n\nexport const x = 1 as unknown as ${source.includes('type') ? 'ModuleOptions' : 'typeof schema'}\n`,
      })
      const result = await migrate(dir)
      expect(result.status, result.output).toBe('stopped')
      expect(result.output).toContain('server/utils/types.ts:1')
    }
  })

  it('stops when a local layer registers the module', async () => {
    const dir = app('layer-module', {
      'nuxt.config.ts': zodConfig,
      'layers/shared/nuxt.config.ts': `export default defineNuxtConfig({\n  modules: ['nuxt-safe-runtime-config'],\n})\n`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('layers/shared/nuxt.config.ts')
  })

  it('stops when another layer sets runtimeConfig the schema would replace', async () => {
    const dir = app('layer-runtime', {
      'nuxt.config.ts': zodConfig,
      'layers/shared/nuxt.config.ts': `export default defineNuxtConfig({\n  runtimeConfig: { keepMe: 'existing layer value' },\n})\n`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('layers/shared/nuxt.config.ts')
  })
})

describe('renaming useSafeRuntimeConfig', () => {
  it('stops when the new name would be captured by a local binding', async () => {
    const dir = app('rename-capture', {
      'nuxt.config.ts': zodConfig,
      'server/utils/read.ts': `export function read(useRuntimeConfig: () => unknown) {\n  return useSafeRuntimeConfig().apiSecret\n}\n`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('server/utils/read.ts:2')
  })

  it('renames references only, keeps calls and unrelated strings', async () => {
    const dir = app('rename-ast', {
      'nuxt.config.ts': zodConfig,
      'server/utils/read.ts': `const label = 'useSafeRuntimeConfig'

export function read() {
  useRuntimeConfig()
  useSafeRuntimeConfig()
  return { label, secret: useSafeRuntimeConfig().apiSecret }
}

export function local() {
  const useSafeRuntimeConfig = () => ({ apiSecret: 'local' })
  return useSafeRuntimeConfig().apiSecret
}
`,
      'test/read.test.ts': `vi.stubGlobal('useRuntimeConfig', () => config)
vi.stubGlobal('useSafeRuntimeConfig', () => config)
;(globalThis as any).useSafeRuntimeConfig = () => config
const type: ReturnType<typeof useSafeRuntimeConfig> = config
`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('migrated')
    expect(read(dir, 'server/utils/read.ts')).toBe(`const label = 'useSafeRuntimeConfig'

export function read() {
  useRuntimeConfig()
  useRuntimeConfig()
  return { label, secret: useRuntimeConfig().apiSecret }
}

export function local() {
  const useSafeRuntimeConfig = () => ({ apiSecret: 'local' })
  return useSafeRuntimeConfig().apiSecret
}
`)
    expect(read(dir, 'test/read.test.ts')).toBe(`vi.stubGlobal('useRuntimeConfig', () => config)
;(globalThis as any).useRuntimeConfig = () => config
const type: ReturnType<typeof useRuntimeConfig> = config
`)
  })
})

describe('module options', () => {
  it('stops on a spread inside safeRuntimeConfig', async () => {
    for (const options of [`...{ envSchema: '.env.example' }`, `$schema: z.object({ a: z.string() }),\n    ...{ $schema: z.object({ b: z.string() }) }`]) {
      const dir = app('options-spread', {
        'nuxt.config.ts': `import { z } from 'zod'\n\nexport default defineNuxtConfig({\n  modules: ['nuxt-safe-runtime-config'],\n  safeRuntimeConfig: {\n    ${options},\n  },\n})\n`,
      })
      const result = await migrate(dir)
      expect(result.status, result.output).toBe('stopped')
      expect(result.output).toContain('spread')
    }
  })

  it('loads .env like Nuxt before reading $schema', async () => {
    const config = `import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  safeRuntimeConfig: {
    $schema: process.env.FIXTURE_USE_SCHEMA ? z.object({ apiSecret: z.string() }) : undefined,
  },
})
`
    const withEnv = app('dotenv', { 'nuxt.config.ts': config, '.env': 'FIXTURE_USE_SCHEMA=1\n' })
    const result = await migrate(withEnv)
    expect(result.status, result.output).toBe('migrated')
    expect(read(withEnv, 'nuxt.config.ts')).toContain('runtimeConfig: process.env.FIXTURE_USE_SCHEMA ? z.object')
    expect(process.env.FIXTURE_USE_SCHEMA).toBeUndefined()

    const withoutEnv = app('dotenv-unset', { 'nuxt.config.ts': config })
    const stopped = await migrate(withoutEnv)
    expect(stopped.status, stopped.output).toBe('stopped')
    expect(stopped.output).toContain('$schema is undefined')
  })
})

describe('placeholders and spreads', () => {
  it('stops before dropping a root placeholder that only one environment requires', async () => {
    const dir = app('placeholder-env', {
      'nuxt.config.ts': `import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    label: '',
  },
  $production: {
    safeRuntimeConfig: {
      $schema: z.object({ label: z.string() }),
    },
  },
})
`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('runtimeConfig.label')
  })

  it('stops when a spread in the config may supply runtimeConfig', async () => {
    const dir = app('root-spread', {
      'nuxt.config.ts': `import { z } from 'zod'

const base = { runtimeConfig: { keepMe: 'spread value' } }

export default defineNuxtConfig({
  ...base,
  modules: ['nuxt-safe-runtime-config'],
  safeRuntimeConfig: {
    $schema: z.object({ apiSecret: z.string().default('x') }),
  },
})
`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('spread')
  })
})

describe('relocated schemas', () => {
  it('stops when a schema moved to the layer reads import.meta', async () => {
    const dir = app('import-meta', {
      'data.txt': 'fallback',
      'nuxt.config.ts': `import { readFileSync } from 'node:fs'
import { z } from 'zod'

const fallback = readFileSync(new URL('./data.txt', import.meta.url), 'utf8')
const schema = z.object({ label: z.string().default(fallback) })

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    shopName: 'Demo shop',
  },
  safeRuntimeConfig: {
    $schema: schema,
  },
})
`,
    })
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(result.output).toContain('import.meta')
  })
})

describe('file traversal', () => {
  it('does not follow symlinks out of the app', async () => {
    const shared = outsideDir({ 'config.ts': `export const read = () => useSafeRuntimeConfig().apiSecret\n` })
    const dir = app('symlink', { 'nuxt.config.ts': zodConfig })
    symlinkSync(shared, join(dir, 'shared'), 'dir')
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('migrated')
    expect(read(shared, 'config.ts')).toContain('useSafeRuntimeConfig')
    expect(result.edits.map(edit => edit.path)).not.toContain('shared/config.ts')
  })

  it('stops when the generated layer would land outside the app', async () => {
    const target = outsideDir({})
    const dir = app('symlink-layer', {
      'nuxt.config.ts': zodConfig.replace(`apiSecret: '',`, `apiSecret: '',\n    shopName: 'Demo shop',`),
    })
    symlinkSync(target, join(dir, 'layers'), 'dir')
    const result = await migrate(dir)
    expect(result.status, result.output).toBe('stopped')
    expect(existsSync(join(target, 'runtime-config'))).toBe(false)
  })
})

describe('dry run', () => {
  it('says that it loads nuxt.config like Nuxt does', async () => {
    const dir = app('dry-run-wording', { 'nuxt.config.ts': zodConfig })
    const result = await migrate(dir, { dryRun: true })
    expect(result.output).toContain('loaded nuxt.config the way Nuxt does')
  })
})

describe('schema preflight', () => {
  it('stops on a union at the root, which Nuxt rejects with NUXT_B5031', async () => {
    const analysis = await analyseSchema(z.union([z.object({ mode: z.literal('a') }), z.object({ mode: z.literal('b') })]))
    expect(analysis.stops.map(stop => stop.note).join('\n')).toContain('one object')
  })

  it('stops on an async superRefine that Nuxt reaches while probing defaults', async () => {
    const analysis = await analyseSchema(z.object({ a: z.string().default('ok').superRefine(async () => {}) }))
    expect(analysis.stops.map(stop => stop.note).join('\n')).toContain('async')
  })

  it('reports a refinement at every key that shares the schema', async () => {
    const check = (value: string) => value.length > 0
    const id = z.string().refine(check)
    const analysis = await analyseSchema(z.object({ sender: id, recipient: id }))
    expect(analysis.refinements.map(note => note.path)).toEqual(expect.arrayContaining(['sender', 'recipient']))
  })

  it('accepts a Valibot object', async () => {
    const analysis = await analyseSchema(v.object({ a: v.optional(v.string(), 'x') }))
    expect(analysis.stops).toEqual([])
  })
})

describe('versions', () => {
  it('uses the lowest version a range allows', () => {
    const check = (range: string) => {
      const dir = outsideDir({})
      const found = dependencyVersion(dir, { dependencies: { nuxt: range } }, 'nuxt')
      return meetsMinimum(found, '4.7.0')
    }
    expect(check('<4.7.0')).toBe(false)
    expect(check('<=5.0.0')).toBe(false)
    expect(check('^4.6')).toBe(false)
    expect(check('*')).toBe(false)
    expect(check('4.7.0-rc.1')).toBe(false)
    expect(check('^4.7.0')).toBe(true)
    expect(check('~4.7.2')).toBe(true)
    expect(check('>=4.7.0 <5')).toBe(true)
  })

  const converterFor = (dependencies: Record<string, string>, files: Record<string, string> = {}) => {
    const dir = outsideDir({ 'package.json': JSON.stringify({ dependencies: { 'nuxt-safe-runtime-config': '^0.4.0', ...dependencies } }, null, 2), ...files })
    const report = createReport()
    const edits = migratePackageJson(dir, true, report)
    const after = (path: string) => edits.find(edit => edit.path === path)?.after ?? undefined
    const pkg = after('package.json')
    return { pkg: pkg ? JSON.parse(pkg) : undefined, workspace: after('pnpm-workspace.yaml'), edits, report }
  }

  it('picks the converter release line that accepts the app\'s Valibot', () => {
    expect(converterFor({ valibot: '1.2.0' }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.5.0')
    expect(converterFor({ valibot: '^1.3.1' }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.6.0')
    expect(converterFor({ valibot: '^1.4.0' }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.7.0')
    expect(converterFor({ valibot: '^1.5.0' }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.8.0')
  })

  it('bumps a Valibot older than 1.2', () => {
    const { pkg, report } = converterFor({ valibot: '^1.1.0' })
    expect(pkg.dependencies.valibot).toBe('^1.2.0')
    expect(pkg.dependencies['@valibot/to-json-schema']).toBe('~1.5.0')
    expect(report.changes.map(note => note.text).join('\n')).toContain('valibot')
  })

  it('reads the lowest Valibot the range allows, not the one installed now', () => {
    const { pkg, report } = converterFor({ valibot: '^1.1.0' }, { 'node_modules/valibot/package.json': JSON.stringify({ name: 'valibot', version: '1.2.0' }) })
    expect(pkg.dependencies.valibot).toBe('^1.2.0')
    expect(pkg.dependencies['@valibot/to-json-schema']).toBe('~1.5.0')
    expect(report.stops).toEqual([])
    expect(converterFor({ valibot: '^1.3.1' }, { 'node_modules/valibot/package.json': JSON.stringify({ name: 'valibot', version: '1.5.0' }) }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.6.0')
  })

  it('sets the converter in the catalog that an existing catalog: specifier names', () => {
    const { pkg, workspace, report } = converterFor({ 'valibot': 'catalog:', '@valibot/to-json-schema': 'catalog:' }, {
      'pnpm-workspace.yaml': 'catalog:\n  "@valibot/to-json-schema": "^1.0.0"\n  valibot: ^1.4.0\n',
    })
    expect(report.stops).toEqual([])
    expect(pkg.dependencies['@valibot/to-json-schema']).toBe('catalog:')
    expect(workspace).toBe('catalog:\n  "@valibot/to-json-schema": "~1.7.0"\n  valibot: ^1.4.0\n')
  })

  it('edits the catalogs of a pnpm-workspace.yaml above the app', () => {
    const root = outsideDir({ 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n\ncatalogs:\n  forms:\n    valibot: \'^1.1.0\'\n' })
    write(join(root, 'apps/web'), { 'package.json': JSON.stringify({ dependencies: { 'nuxt-safe-runtime-config': '^0.4.0', 'valibot': 'catalog:forms' } }, null, 2) })
    const report = createReport()
    const edits = migratePackageJson(join(root, 'apps/web'), true, report)
    expect(report.stops).toEqual([])
    expect(edits.map(edit => edit.path)).toEqual(['package.json', '../../pnpm-workspace.yaml'])
    expect(edits[1]!.after).toBe('packages:\n  - apps/*\n\ncatalogs:\n  forms:\n    \'@valibot/to-json-schema\': ~1.5.0\n    valibot: \'^1.2.0\'\n')
    expect(report.changes.map(note => `${note.file}:${note.line} ${note.text}`)).toEqual([expect.stringMatching(/^\.\.\/\.\.\/pnpm-workspace\.yaml:7 valibot \^1\.1\.0 in the forms catalog becomes \^1\.2\.0/)])
  })

  it('stops on a catalog it can\'t read, and edits a named one', () => {
    const { report } = converterFor({ valibot: 'catalog:' }, { 'pnpm-workspace.yaml': 'catalog: { valibot: ^1.1.0 }\n' })
    expect(report.stops.map(note => note.text).join('\n')).toContain('valibot catalog: is not a version range')
    const named = converterFor({ valibot: 'catalog:forms' }, { 'pnpm-workspace.yaml': 'catalogs:\n  forms:\n    valibot: ^1.1.0\n' })
    expect(named.report.stops).toEqual([])
    expect(named.workspace).toContain('valibot: ^1.2.0')
  })

  it('narrows an existing converter range that would pull an incompatible release', () => {
    expect(converterFor({ 'valibot': '1.2.0', '@valibot/to-json-schema': '^1.5.0' }).pkg.dependencies['@valibot/to-json-schema']).toBe('~1.5.0')
    expect(converterFor({ 'valibot': '^1.5.0', '@valibot/to-json-schema': '^1.8.0' }).pkg).toBeDefined()
    expect(converterFor({ 'valibot': '^1.5.0', '@valibot/to-json-schema': '^1.8.0' }).pkg.dependencies['@valibot/to-json-schema']).toBe('^1.8.0')
  })
})
