import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const tempRoot = await mkdtemp(join(tmpdir(), 'safe-runtime-config-nuxt5-'))
const packDir = join(tempRoot, 'pack')
const appDir = join(tempRoot, 'app')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

try {
  await mkdir(packDir, { recursive: true })
  await mkdir(appDir, { recursive: true })

  run('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })

  const packedFiles = await readdir(packDir)
  const tarball = packedFiles.find(file => file.endsWith('.tgz'))
  if (!tarball)
    throw new Error(`No package tarball found in ${packDir}`)

  const tarballPath = join(packDir, tarball)

  await writeFile(join(appDir, 'package.json'), `${JSON.stringify({
    type: 'module',
    private: true,
    scripts: {
      prepare: 'nuxt prepare',
      build: 'nuxt build',
    },
    dependencies: {
      '@nuxt/kit': 'npm:@nuxt/kit-nightly@5x',
      '@nuxt/schema': 'npm:@nuxt/schema-nightly@5x',
      '@valibot/to-json-schema': '^1.3.0',
      'nuxt': 'npm:nuxt-nightly@5x',
      'nuxt-safe-runtime-config': `file:${tarballPath}`,
      'valibot': '^1.1.0',
    },
  }, null, 2)}\n`)

  await writeFile(join(appDir, 'app.vue'), `<template>
  <div>{{ config.public.apiBase }}</div>
</template>

<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>
`)

  await writeFile(join(appDir, 'nuxt.config.ts'), `import { object, string } from 'valibot'

const runtimeConfigSchema = object({
  public: object({ apiBase: string() }),
  secretKey: string(),
})

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    secretKey: 'test-secret',
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
  },
})
`)

  run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], { cwd: appDir })
  run('pnpm', ['prepare'], { cwd: appDir })
  run('pnpm', ['build'], { cwd: appDir })

  console.log(`Nuxt 5 nightly smoke test passed in ${appDir}`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error(`Nuxt 5 nightly smoke test temp directory: ${tempRoot}`)
  process.exit(1)
}
