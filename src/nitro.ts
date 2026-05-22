import type { Nitro, NitroModule } from 'nitro/types'
import type { ResolvedValidationOptions, RuntimeValidationArtifacts } from './validation'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consola } from 'consola'
import { createRuntimeValidationArtifacts, resolveValidationOptions, validateRuntimeConfig } from './validation'

export { transformEnvVars } from './runtime/utils/transform'
export type { ErrorBehavior, ValidationOptions } from './types'

const logger = consola.withTag('safe-runtime-config')

// Resolve runtime plugin path across three layouts:
// - src (tests/monorepo): `./runtime/nitro/validate-plugin.ts`
// - dist sibling: `./runtime/nitro/validate-plugin.js`
// - dist shared chunk (bundled into dist/shared/*): `../runtime/nitro/validate-plugin.js`
function resolveRuntimePlugin(): string {
  const candidates = [
    './runtime/nitro/validate-plugin.ts',
    './runtime/nitro/validate-plugin.js',
    '../runtime/nitro/validate-plugin.js',
  ] as const
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(path))
      return path
  }
  return fileURLToPath(new URL(candidates[2], import.meta.url))
}

export const RUNTIME_PLUGIN_PATH = resolveRuntimePlugin()

export function resolveRuntimeConfigImport(): string {
  return 'nitro/runtime-config'
}

async function writeFileIfChanged(file: string, contents: string): Promise<void> {
  try {
    if (await readFile(file, 'utf8') === contents)
      return
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents)
}

async function writeArtifacts(nitro: Nitro, artifacts: RuntimeValidationArtifacts): Promise<void> {
  const outDir = join(nitro.options.buildDir, 'safe-runtime-config')
  await Promise.all([
    writeFileIfChanged(join(outDir, 'validate.mjs'), artifacts.validateTemplate),
    writeFileIfChanged(join(outDir, 'validate.d.ts'), artifacts.validateTemplateDeclaration),
    writeFileIfChanged(join(nitro.options.buildDir, 'types/safe-runtime-config.d.ts'), artifacts.typeDeclaration),
  ])
}

function pushUnique<T>(list: T[], item: T): void {
  if (!list.includes(item))
    list.push(item)
}

function configureNitro(nitro: Nitro, options: ResolvedValidationOptions, validateModule: string, typeDeclaration: string): void {
  nitro.options.alias ||= {}
  nitro.options.alias['#safe-runtime-config/validate'] = validateModule

  const ts = (nitro.options.typescript ||= {} as Nitro['options']['typescript'])
  ts.tsConfig ||= {}
  ts.tsConfig.include ||= []
  pushUnique(ts.tsConfig.include, `./${relative(nitro.options.buildDir, typeDeclaration)}`)

  if (options.validateAtRuntime) {
    nitro.options.alias['#safe-runtime-config/nitro-runtime-config'] = resolveRuntimeConfigImport()
    nitro.options.plugins ||= []
    pushUnique(nitro.options.plugins, RUNTIME_PLUGIN_PATH)
  }
}

const safeRuntimeConfigNitroModule: NitroModule = {
  name: 'nuxt-safe-runtime-config/nitro',
  async setup(nitro) {
    const options = resolveValidationOptions(nitro.options.safeRuntimeConfig)
    if (!options.$schema)
      return

    const artifacts = await createRuntimeValidationArtifacts(options, msg => logger.warn(msg))
    if (!artifacts)
      return

    const applyArtifacts = async (): Promise<void> => {
      const validateModule = join(nitro.options.buildDir, 'safe-runtime-config/validate.mjs')
      const typeDeclaration = join(nitro.options.buildDir, 'types/safe-runtime-config.d.ts')

      await writeArtifacts(nitro, artifacts)
      configureNitro(nitro, options, validateModule, typeDeclaration)
    }

    await applyArtifacts()

    nitro.hooks.hook('rollup:before', applyArtifacts)

    if (options.validateAtBuild) {
      nitro.hooks.hook('build:before', async () => {
        await applyArtifacts()
        await validateRuntimeConfig(nitro.options.runtimeConfig, options.$schema!, options.onError, logger)
      })
    }
  },
}

export default safeRuntimeConfigNitroModule
