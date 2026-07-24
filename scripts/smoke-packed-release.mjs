import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const tempRoot = mkdtempSync(join('/tmp', 'safe-runtime-config-packed-'))
const packDir = join(tempRoot, 'pack')

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function allowEsbuild(appDir) {
  writeFileSync(join(appDir, 'pnpm-workspace.yaml'), `allowBuilds:
  esbuild: true
`)
}

function tail(output) {
  return output.split('\n').slice(-80).join('\n')
}

function run(name, command, args, options = {}) {
  const cwd = options.cwd || repoRoot
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    shell: false,
    timeout: options.timeout || 180_000,
  })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  const logPath = join(cwd, `${name.replaceAll(/[^\w.-]+/g, '-')}.log`)
  writeFileSync(logPath, output)

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${name} failed with exit code ${result.status ?? result.signal}\nLog: ${logPath}\n${tail(output)}`)
  }

  return { ...result, output, logPath }
}

function createEslintConsumer(appDir, tarballPath) {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(appDir, { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    type: 'module',
    private: true,
    dependencies: {
      'nuxt-safe-runtime-config': `file:${tarballPath}`,
      'eslint': '^9.0.0',
      'typescript': '^5.8.3',
    },
  })
  writeFileSync(join(appDir, 'eslint.config.mjs'), `import safeRuntimeConfig from 'nuxt-safe-runtime-config/eslint'

export default [
  safeRuntimeConfig.configs.recommended,
]
`)
  writeFileSync(join(appDir, 'sample.js'), `const config = useRuntimeConfig()
console.log(config.public)
`)
}

function createArkTypeConsumer(appDir, tarballPath) {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(appDir, { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    type: 'module',
    private: true,
    scripts: {
      prepare: 'nuxt prepare',
      build: 'nuxt build',
    },
    dependencies: {
      'nuxt-safe-runtime-config': `file:${tarballPath}`,
      'arktype': '^2.2.0',
      'nuxt': '^4',
      'typescript': '^5.8.3',
    },
  })
  allowEsbuild(appDir)
  writeFileSync(join(appDir, 'app.vue'), `<template>
  <div>{{ config.public.apiBase }}</div>
</template>

<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>
`)
  writeFileSync(join(appDir, 'nuxt.config.ts'), `import { type } from 'arktype'

const runtimeConfigSchema = type({
  'public': {
    'apiBase': 'string',
    'appName?': 'string',
  },
  'databaseUrl': 'string',
  'secretKey': 'string',
  'port?': 'number',
})

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    databaseUrl: 'postgresql://localhost:5432/app',
    secretKey: 'test-secret',
    port: 3000,
    public: {
      apiBase: 'https://api.example.com',
      appName: 'ArkType Test',
    },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
`)
}

function createNitroConsumer(appDir, tarballPath, majorVersion) {
  const packageName = majorVersion >= 3 ? 'nitro' : 'nitropack'
  const packageVersion = majorVersion >= 3 ? '3.0.260429-beta' : '^2.13.0'

  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(join(appDir, 'server/api'), { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    type: 'module',
    private: true,
    scripts: {
      build: 'nitro build',
      prepare: 'nitro prepare',
      typecheck: 'tsc --noEmit --module preserve --moduleResolution bundler --target esnext --skipLibCheck true --types node nitro.config.ts',
    },
    dependencies: {
      '@types/node': 'latest',
      'nuxt-safe-runtime-config': `file:${tarballPath}`,
      'typescript': '^5.8.3',
      'valibot': '^1.1.0',
      [packageName]: packageVersion,
    },
  })
  allowEsbuild(appDir)
  writeFileSync(join(appDir, 'server/api/config.get.ts'), `export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { port: config.port }
})
`)
  writeFileSync(join(appDir, 'nitro.config.ts'), `import { number, object, string } from 'valibot'
import { defineNitroConfig } from '${packageName}/config'
import SafeRuntimeConfig from 'nuxt-safe-runtime-config/nitro'

const runtimeConfigSchema = object({
  port: number(),
  secretKey: string(),
  public: object({ apiBase: string() }),
})

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    port: 3000,
    secretKey: 'test-secret',
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
  },
})
`)
}

try {
  mkdirSync(packDir, { recursive: true })
  run('pack', 'pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })

  const tarball = readdirSync(packDir).find(file => file.endsWith('.tgz'))
  if (!tarball)
    throw new Error(`No package tarball found in ${packDir}`)

  const tarballPath = join(packDir, tarball)

  const eslintDir = join(tempRoot, 'eslint-consumer')
  createEslintConsumer(eslintDir, tarballPath)
  run('eslint-install', 'pnpm', ['install', '--no-frozen-lockfile'], { cwd: eslintDir, timeout: 240_000 })
  const eslintOutput = run('eslint-detect', 'pnpm', ['exec', 'eslint', '.'], { cwd: eslintDir })
  if (!eslintOutput.output.includes('Use useSafeRuntimeConfig()'))
    throw new Error(`eslint rule did not report useRuntimeConfig()\nLog: ${eslintOutput.logPath}`)
  run('eslint-fix', 'pnpm', ['exec', 'eslint', '.', '--fix'], { cwd: eslintDir })
  const fixedSample = readFileSync(join(eslintDir, 'sample.js'), 'utf8')
  if (!fixedSample.includes('useSafeRuntimeConfig()'))
    throw new Error(`eslint --fix did not rewrite sample.js\n${fixedSample}`)

  const arktypeDir = join(tempRoot, 'arktype-consumer')
  createArkTypeConsumer(arktypeDir, tarballPath)
  run('arktype-install', 'pnpm', ['install', '--no-frozen-lockfile'], { cwd: arktypeDir, timeout: 240_000 })
  run('arktype-prepare', 'pnpm', ['prepare'], { cwd: arktypeDir })
  const arktypeBuild = run('arktype-build', 'pnpm', ['build'], { cwd: arktypeDir, timeout: 240_000 })
  if (arktypeBuild.output.includes('Schema is not Standard Schema compatible'))
    throw new Error(`ArkType build still rejected the callable Standard Schema\nLog: ${arktypeBuild.logPath}`)

  const nitro3Dir = join(tempRoot, 'nitro3-consumer')
  createNitroConsumer(nitro3Dir, tarballPath, 3)
  run('nitro3-install', 'pnpm', ['install', '--no-frozen-lockfile'], { cwd: nitro3Dir, timeout: 240_000 })
  run('nitro3-import', 'node', ['-e', 'await import("nuxt-safe-runtime-config/nitro")'], { cwd: nitro3Dir })
  if (existsSync(join(nitro3Dir, 'node_modules/@nuxt/kit')))
    throw new Error('Nitro-only consumer unexpectedly installed @nuxt/kit')
  run('nitro3-typecheck', 'pnpm', ['typecheck'], { cwd: nitro3Dir })
  run('nitro3-build', 'pnpm', ['build'], { cwd: nitro3Dir, timeout: 240_000 })
  const nitroServer = run('nitro3-server-invalid-env', 'node', ['.output/server/index.mjs'], {
    cwd: nitro3Dir,
    env: {
      NITRO_PORT: 'not-a-number',
      PORT: '48765',
    },
    allowFailure: true,
    timeout: 8_000,
  })
  if (nitroServer.status === 0)
    throw new Error(`Nitro runtime validation server unexpectedly succeeded\nLog: ${nitroServer.logPath}`)
  if (nitroServer.output.includes('ReferenceError: defineNitroPlugin is not defined'))
    throw new Error(`Nitro runtime validation server still has an unbound defineNitroPlugin\nLog: ${nitroServer.logPath}`)
  if (!nitroServer.output.includes('Runtime validation failed') || !nitroServer.output.includes('port'))
    throw new Error(`Nitro runtime validation server did not report the invalid port\nLog: ${nitroServer.logPath}\n${tail(nitroServer.output)}`)

  const nitro2Dir = join(tempRoot, 'nitro2-consumer')
  createNitroConsumer(nitro2Dir, tarballPath, 2)
  run('nitro2-install', 'pnpm', ['install', '--no-frozen-lockfile'], { cwd: nitro2Dir, timeout: 240_000 })
  run('nitro2-import', 'node', ['-e', 'await import("nuxt-safe-runtime-config/nitro")'], { cwd: nitro2Dir })
  const nitroEntryTypes = readFileSync(join(nitro2Dir, 'node_modules/nuxt-safe-runtime-config/dist/nitro.d.mts'), 'utf8')
  if (/from ['"]nitro\/types['"]/.test(nitroEntryTypes))
    throw new Error('Nitro 2 consumer types still import Nitro 3 types')
  run('nitro2-prepare', 'pnpm', ['prepare'], { cwd: nitro2Dir })
  run('nitro2-typecheck', 'pnpm', ['typecheck'], { cwd: nitro2Dir })
  run('nitro2-build', 'pnpm', ['build'], { cwd: nitro2Dir, timeout: 240_000 })

  console.log(`Packed release smoke test passed in ${tempRoot}`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error(`Packed release smoke test temp directory: ${tempRoot}`)
  process.exit(1)
}
