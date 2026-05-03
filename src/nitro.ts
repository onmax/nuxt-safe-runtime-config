import type { ValidationOptions } from './types'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consola } from 'consola'
import { createRuntimeValidationArtifacts, resolveValidationOptions, validateRuntimeConfig } from './validation'

export { transformEnvVars } from './runtime/utils/transform'
export type { ErrorBehavior, ValidationOptions } from './types'

interface NitroLike {
  hooks?: {
    hook?: (name: string, handler: (...args: any[]) => any) => void
  }
  options: {
    buildDir: string
    rootDir: string
    runtimeConfig?: unknown
    alias?: Record<string, string>
    plugins?: string[]
    safeRuntimeConfig?: ValidationOptions
    typescript?: {
      tsConfig?: {
        include?: string[]
      }
    }
  }
}

interface InternalValidationOptions extends ValidationOptions {
  _skipInitialValidation?: boolean
}

export interface NitroModuleLike {
  name?: string
  setup: (nitro: NitroLike) => void | Promise<void>
}

const logger = consola.withTag('safe-runtime-config')

function resolveRuntimeEntry(srcRelative: string, distRelative: string): string {
  const sourcePath = fileURLToPath(new URL(srcRelative, import.meta.url))
  if (existsSync(sourcePath))
    return sourcePath

  const distPath = fileURLToPath(new URL(distRelative, import.meta.url))
  if (existsSync(distPath))
    return distPath

  return fileURLToPath(new URL(`../${distRelative.replace(/^\.\//, '')}`, import.meta.url))
}

function resolveRuntimeConfigImport(rootDir: string): string {
  const require = createRequire(join(rootDir, 'package.json'))
  try {
    require.resolve('nitro/package.json')
    return 'nitro/runtime-config'
  }
  catch {
    return 'nitropack/runtime'
  }
}

function ensureNitroAliases(nitro: NitroLike): void {
  nitro.options.alias ||= {}
  nitro.options.alias['#safe-runtime-config/nitro-runtime-config'] = resolveRuntimeConfigImport(nitro.options.rootDir)
}

function addPluginOnce(nitro: NitroLike, plugin: string): void {
  nitro.options.plugins ||= []
  if (!nitro.options.plugins.includes(plugin))
    nitro.options.plugins.push(plugin)
}

function addTypeInclude(nitro: NitroLike, file: string): void {
  nitro.options.typescript ||= {}
  nitro.options.typescript.tsConfig ||= {}
  nitro.options.typescript.tsConfig.include ||= []

  const relativePath = `./${relative(nitro.options.buildDir, file)}`
  if (!nitro.options.typescript.tsConfig.include.includes(relativePath))
    nitro.options.typescript.tsConfig.include.push(relativePath)
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

async function registerRuntimeValidation(nitro: NitroLike, options: ReturnType<typeof resolveValidationOptions>): Promise<void> {
  const artifacts = await createRuntimeValidationArtifacts(options, msg => logger.warn(msg))
  if (!artifacts)
    return

  const outDir = join(nitro.options.buildDir, 'safe-runtime-config')
  const validateModule = join(outDir, 'validate.mjs')
  const validateDeclaration = join(outDir, 'validate.d.ts')
  const typeDeclaration = join(nitro.options.buildDir, 'types/safe-runtime-config.d.ts')

  await Promise.all([
    writeFileIfChanged(validateModule, artifacts.validateTemplate),
    writeFileIfChanged(validateDeclaration, artifacts.validateTemplateDeclaration),
    writeFileIfChanged(typeDeclaration, artifacts.typeDeclaration),
  ])

  nitro.options.alias ||= {}
  nitro.options.alias['#safe-runtime-config/validate'] = validateModule
  addTypeInclude(nitro, typeDeclaration)

  if (options.validateAtRuntime) {
    ensureNitroAliases(nitro)
    addPluginOnce(nitro, resolveRuntimeEntry('./runtime/nitro/validate-plugin.ts', './runtime/nitro/validate-plugin.js'))
  }
}

const safeRuntimeConfigNitroModule: NitroModuleLike = {
  name: 'nuxt-safe-runtime-config/nitro',
  async setup(nitro) {
    const rawOptions = nitro.options.safeRuntimeConfig as InternalValidationOptions | undefined
    const options = resolveValidationOptions(rawOptions)
    if (!options.$schema)
      return

    await registerRuntimeValidation(nitro, options)

    if (options.validateAtBuild && !rawOptions?._skipInitialValidation) {
      await validateRuntimeConfig(nitro.options.runtimeConfig, options.$schema, options.onError, logger)
    }

    if (options.validateAtBuild) {
      nitro.hooks?.hook?.('build:before', async () => {
        await validateRuntimeConfig(nitro.options.runtimeConfig, options.$schema!, options.onError, logger)
      })
    }

    nitro.hooks?.hook?.('build:before', async () => {
      await registerRuntimeValidation(nitro, options)
    })
    nitro.hooks?.hook?.('dev:reload', async () => {
      await registerRuntimeValidation(nitro, options)
    })
  },
}

export default safeRuntimeConfigNitroModule
