// End-to-end check of `nuxt-safe-runtime-config migrate` against a real Nuxt 4.7 install.
// It packs this package, installs it with nuxt@4.7.0 in a temporary directory outside the
// workspace, migrates small apps with the packed CLI, builds them and starts each server.
// Set E2E_KEEP=1 to keep the temporary directory.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'nsrc-migrate-e2e-'))
const keep = process.env.E2E_KEEP === '1'
const results = []

function log(text = '') {
  process.stdout.write(`${text}\n`)
}

function check(app, name, ok, detail = '') {
  results.push({ app, name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'} ${app}: ${name}${detail ? ` (${detail})` : ''}`)
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd ?? work, env: options.env ?? cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('close', code => resolve({ code, output }))
  })
}

/** The current environment without NUXT_* variables, so the host shell can't leak config in. */
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NUXT_') && !key.startsWith('NITRO_')))
  return { ...env, ...extra }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * Starts the built server with only `vars` set. Resolves with the JSON of GET /api/config when it
 * answers, or with the exit code and output when the process exits first. Stops only its own pid.
 */
async function startServer(appDir, vars) {
  const port = await freePort()
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), HOST: '127.0.0.1', ...vars }
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  let exitCode
  exited.then((code) => {
    exitCode = code
  })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (exitCode !== undefined)
      return { exitCode, output }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/config`)
      const body = await response.json()
      child.kill()
      await exited
      return { status: response.status, body, output }
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  child.kill('SIGKILL')
  await exited
  return { exitCode: 'timeout', output }
}

function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
}

const tsconfig = `${JSON.stringify({
  files: [],
  references: ['app', 'server', 'shared', 'node'].map(name => ({ path: `./.nuxt/tsconfig.${name}.json` })),
}, null, 2)}\n`

function appPackage(name, deps) {
  return `${JSON.stringify({ name, private: true, type: 'module', dependencies: { 'nuxt': '4.7.0', 'nuxt-safe-runtime-config': '^0.4.0', ...deps } }, null, 2)}\n`
}

const expectError = '  // @ts-expect-error the schema types this key as a number\n'

/** Each app: its files, the env for each check, and what the migration must produce. */
const apps = [
  {
    name: 'zod-direct',
    route: 'direct',
    files: {
      'package.json': appPackage('zod-direct', { zod: '^4.6.7' }),
      'tsconfig.json': tsconfig,
      'nuxt.config.ts': `import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  compatibilityDate: '2026-11-01',
  runtimeConfig: {
    apiSecret: '',
  },
  safeRuntimeConfig: {
    $schema: z.object({
      apiSecret: z.string(),
      retries: z.number().default(3),
      verbose: z.boolean().default(false),
      public: z.object({
        apiBase: z.string().url().default('https://api.example.com'),
      }),
    }),
  },
})
`,
      'server/api/config.get.ts': `export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()
  return { apiSecret: config.apiSecret, retries: config.retries, verbose: config.verbose, apiBase: config.public.apiBase }
})
`,
      'server/api/types.get.ts': `export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()
  const retries: number = config.retries
${expectError}  const wrong: string = config.retries
  return { retries, wrong }
})
`,
    },
    typecheck: 'server/api/types.get.ts',
    valid: { vars: { NUXT_API_SECRET: 's3cret', NUXT_RETRIES: '5', NUXT_VERBOSE: 'true' }, expect: { apiSecret: 's3cret', retries: 5, verbose: true, apiBase: 'https://api.example.com' } },
    wrongType: { NUXT_API_SECRET: 's3cret', NUXT_RETRIES: 'abc' },
    placeholder: { key: 'apiSecret', vars: { NUXT_RETRIES: '5' } },
    badUrl: { vars: { NUXT_API_SECRET: 's3cret', NUXT_PUBLIC_API_BASE: 'not-a-url' }, field: 'apiBase', refinement: 'public.apiBase: format uri' },
  },
  {
    name: 'valibot-direct',
    route: 'direct',
    files: {
      'package.json': appPackage('valibot-direct', { 'valibot': '^1.5.0', '@valibot/to-json-schema': '^1.8.0' }),
      'nuxt.config.ts': `import { number, object, optional, pipe, string, url } from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  compatibilityDate: '2026-11-01',
  runtimeConfig: {
    apiToken: '',
  },
  safeRuntimeConfig: {
    $schema: object({
      apiToken: string(),
      maxItems: optional(number(), 10),
      public: object({
        siteUrl: optional(pipe(string(), url()), 'https://example.com'),
      }),
    }),
  },
})
`,
      'server/api/config.get.ts': `export default defineEventHandler(() => {
  const { apiToken, maxItems, public: { siteUrl } } = useSafeRuntimeConfig()
  return { apiToken, maxItems, siteUrl }
})
`,
    },
    valid: { vars: { NUXT_API_TOKEN: 'token', NUXT_MAX_ITEMS: '25' }, expect: { apiToken: 'token', maxItems: 25, siteUrl: 'https://example.com' } },
    wrongType: { NUXT_API_TOKEN: 'token', NUXT_MAX_ITEMS: 'many' },
    placeholder: { key: 'apiToken', vars: { NUXT_MAX_ITEMS: '25' } },
    badUrl: { vars: { NUXT_API_TOKEN: 'token', NUXT_PUBLIC_SITE_URL: 'not-a-url' }, field: 'siteUrl', refinement: 'public.siteUrl: format uri' },
  },
  {
    name: 'valibot-layer',
    route: 'layer',
    files: {
      'package.json': appPackage('valibot-layer', { valibot: '^1.5.0' }),
      'tsconfig.json': tsconfig,
      'nuxt.config.ts': `import * as v from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  compatibilityDate: '2026-11-01',
  runtimeConfig: {
    apiToken: '',
    shopName: 'Demo shop',
    studio: { allowedIds: ['22'] },
    public: {
      siteUrl: 'https://example.com',
    },
  },
  safeRuntimeConfig: {
    $schema: v.object({
      apiToken: v.string(),
      shopName: v.string(),
      maxItems: v.optional(v.number(), 10),
      public: v.object({
        siteUrl: v.pipe(v.string(), v.url()),
      }),
    }),
  },
})
`,
      'server/api/config.get.ts': `export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()
  return { apiToken: config.apiToken, shopName: config.shopName, maxItems: config.maxItems, siteUrl: config.public.siteUrl, studio: config.studio }
})
`,
      'server/api/types.get.ts': `export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()
  const maxItems: number = config.maxItems
${expectError}  const wrong: string = config.maxItems
  return { maxItems, wrong }
})
`,
    },
    typecheck: 'server/api/types.get.ts',
    valid: { vars: { NUXT_API_TOKEN: 'token', NUXT_MAX_ITEMS: '25' }, expect: { apiToken: 'token', shopName: 'Demo shop', maxItems: 25, siteUrl: 'https://example.com', studio: { allowedIds: ['22'] } } },
    wrongType: { NUXT_API_TOKEN: 'token', NUXT_MAX_ITEMS: 'many' },
    placeholder: { key: 'apiToken', vars: { NUXT_MAX_ITEMS: '25' } },
    badUrl: { vars: { NUXT_API_TOKEN: 'token', NUXT_PUBLIC_SITE_URL: 'not-a-url' }, field: 'siteUrl', refinement: 'public.siteUrl: format uri' },
  },
  {
    name: 'zod-schema-file',
    route: 'direct',
    files: {
      'package.json': appPackage('zod-schema-file', { zod: '^4.6.7' }),
      'runtime-config.schema.ts': `import { z } from 'zod'

export default z.object({
  databaseUrl: z.string(),
  poolSize: z.number().int().default(4),
})
`,
      'nuxt.config.ts': `export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  compatibilityDate: '2026-11-01',
  runtimeConfig: {
    databaseUrl: '',
  },
  safeRuntimeConfig: {
    $schema: './runtime-config.schema',
  },
})
`,
      'server/api/config.get.ts': `export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()
  return { databaseUrl: config.databaseUrl, poolSize: config.poolSize }
})
`,
    },
    valid: { vars: { NUXT_DATABASE_URL: 'postgres://db', NUXT_POOL_SIZE: '8' }, expect: { databaseUrl: 'postgres://db', poolSize: 8 } },
    wrongType: { NUXT_DATABASE_URL: 'postgres://db', NUXT_POOL_SIZE: 'eight' },
    placeholder: { key: 'databaseUrl', vars: { NUXT_POOL_SIZE: '8' } },
  },
]

function sameValues(actual, expected) {
  return Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual?.[key], value))
}

async function main() {
  log(`Work directory: ${work}`)

  // 1. Pack this package (pnpm pack runs prepack, which builds dist/).
  const packed = await run('pnpm', ['pack', '--pack-destination', work], { cwd: repo })
  const tarball = readdirSync(work).find(file => file.endsWith('.tgz'))
  if (packed.code !== 0 || !tarball)
    throw new Error(`pnpm pack failed:\n${packed.output}`)

  // 2. Install it with a real Nuxt 4.7 outside the workspace.
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({
    name: 'nsrc-migrate-e2e',
    private: true,
    type: 'module',
    dependencies: {
      'nuxt': '4.7.0',
      'nuxt-safe-runtime-config': `file:./${tarball}`,
      'zod': '^4.6.7',
      'valibot': '^1.5.0',
      '@valibot/to-json-schema': '^1.8.0',
      'typescript': '^6.0.3',
      'vue-tsc': '^3.3.14',
    },
  }, null, 2)}\n`)
  const install = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'])
  if (install.code !== 0)
    throw new Error(`npm install failed:\n${install.output}`)
  const nuxtVersion = JSON.parse(readFileSync(join(work, 'node_modules/nuxt/package.json'), 'utf8')).version
  log(`Installed nuxt ${nuxtVersion}`)
  const cli = join(work, 'node_modules/.bin/nuxt-safe-runtime-config')
  const nuxt = join(work, 'node_modules/.bin/nuxt')

  for (const app of apps) {
    const dir = join(work, 'apps', app.name)
    writeFiles(dir, app.files)

    // 3. Migrate with the packed CLI.
    const migrated = await run(cli, ['migrate', dir])
    const layer = existsSync(join(dir, 'layers/runtime-config/nuxt.config.ts'))
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const leftovers = Object.keys(app.files).filter(path => /useSafeRuntimeConfig|safeRuntimeConfig|nuxt-safe-runtime-config/.test(readFileSync(join(dir, path), 'utf8')))
    check(app.name, 'migrate exits 0', migrated.code === 0, migrated.code === 0 ? '' : migrated.output)
    check(app.name, `takes the ${app.route} route`, layer === (app.route === 'layer'))
    check(app.name, 'removes every use of the module', leftovers.length === 0 && !pkg.dependencies['nuxt-safe-runtime-config'], leftovers.join(', '))
    const again = await run(cli, ['migrate', dir])
    check(app.name, 'second run changes nothing', again.code === 0 && again.output.includes('Nothing to migrate'))
    writeFileSync(join(dir, 'migrate.log'), migrated.output)

    // 4. Build.
    const build = await run(nuxt, ['build'], { cwd: dir })
    writeFileSync(join(dir, 'build.log'), build.output)
    check(app.name, 'nuxt build exits 0', build.code === 0, build.code === 0 ? '' : build.output.slice(-2000))
    if (build.code !== 0)
      continue

    // 5. Runtime behaviour.
    const valid = await startServer(dir, app.valid.vars)
    check(app.name, 'valid NUXT_* values: 200 with coerced values', valid.status === 200 && sameValues(valid.body, app.valid.expect), JSON.stringify(valid.body ?? valid.output.slice(-500)))

    const wrong = await startServer(dir, app.wrongType)
    check(app.name, 'wrong type: exits non-zero with NUXT_E8014', typeof wrong.exitCode === 'number' && wrong.exitCode !== 0 && wrong.output.includes('NUXT_E8014'), `exit ${wrong.exitCode ?? 'none'}`)

    const unset = await startServer(dir, app.placeholder.vars)
    check(app.name, `unset former '' placeholder ${app.placeholder.key}: NUXT_E8014`, typeof unset.exitCode === 'number' && unset.exitCode !== 0 && unset.output.includes('NUXT_E8014') && unset.output.includes(app.placeholder.key), `exit ${unset.exitCode ?? 'none'}`)

    if (app.badUrl) {
      const bad = await startServer(dir, app.badUrl.vars)
      check(app.name, 'bad URL: server starts, and the report lists the refinement', bad.status === 200 && bad.body?.[app.badUrl.field] === 'not-a-url' && migrated.output.includes(app.badUrl.refinement), JSON.stringify(bad.body ?? bad.output.slice(-500)))
    }

    // 6. Types: the schema types the key as a number, and the control without @ts-expect-error fails.
    if (app.typecheck) {
      const typecheck = await run(nuxt, ['typecheck'], { cwd: dir })
      writeFileSync(join(dir, 'typecheck.log'), typecheck.output)
      check(app.name, 'nuxt typecheck types the key as a number', typecheck.code === 0, typecheck.code === 0 ? '' : typecheck.output.slice(-2000))

      const file = join(dir, app.typecheck)
      const source = readFileSync(file, 'utf8')
      writeFileSync(file, source.replace(expectError, ''))
      const control = await run(nuxt, ['typecheck'], { cwd: dir })
      writeFileSync(file, source)
      writeFileSync(join(dir, 'typecheck-control.log'), control.output)
      check(app.name, 'negative control: typecheck fails without @ts-expect-error', control.code !== 0 && control.output.includes('TS2322'), `exit ${control.code}`)
    }
  }
}

function finish(started, crashed) {
  const failed = results.filter(result => !result.ok)
  log()
  log(`${results.length - failed.length}/${results.length} checks passed in ${Math.round((Date.now() - started) / 1000)}s.`)
  if (crashed)
    log(`Crashed: ${crashed.stack ?? crashed}`)
  if (keep || failed.length || crashed)
    log(`Kept ${work}`)
  else
    rmSync(work, { recursive: true, force: true })
  process.exitCode = failed.length || crashed || !results.length ? 1 : 0
}

const started = Date.now()
main().then(() => finish(started), error => finish(started, error))
