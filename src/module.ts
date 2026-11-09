/// <reference types="@nuxt/nitro-server/augments" />
import type { Nuxt } from '@nuxt/schema'
import type { ModuleOptions } from './types'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { addImports, addServerImports, addTypeTemplate, createResolver, defineNuxtModule, getNuxtVersion, useLogger } from '@nuxt/kit'
import { version } from '../package.json'
import { compileEnvSchema } from './env-schema/nuxt'
import { parseEnvSchema } from './env-schema/profile'
import { createEnvSchemaValidator } from './env-schema/standard'
import { registerEnvSchemaPaths, registerNativeSchema, supportsNativeSchemas } from './native-schema'
import safeRuntimeConfigNitroModule, { resolveRuntimeConfigImport } from './nitro'
import { createRuntimeValidationArtifacts, resolveValidationOptions } from './validation'

export type { ErrorBehavior, ModuleOptions, SchemaSource, ValidationOptions } from './types'

const logger = useLogger('safe-runtime-config')

function explainNuxt5(nuxt: Nuxt): void {
  if (Number.parseInt(getNuxtVersion(nuxt), 10) < 5)
    return
  logger.info([
    'Nuxt 5 checks runtimeConfig schemas itself. This module adds the checks Nuxt skips: formats, ranges, patterns, refinements and transforms.',
    'To move secrets out of runtime config, see @vite-hub/env: https://nuxt-safe-runtime-config.onmax.me/guide/nuxt-5',
  ].join('\n'))
}

// Nuxt 4.2+ runs Nitro through @nuxt/nitro-server, which can resolve a different Nitro copy than `nuxt` does.
// The runtime config import must come from the copy that builds the server, or prerendering can't resolve its virtual modules.
function resolveNitroParent(nuxtPackage: string): string {
  try {
    return createRequire(nuxtPackage).resolve('@nuxt/nitro-server/package.json')
  }
  catch {
    return nuxtPackage
  }
}

function applyEnvSchemaDefaults(config: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = config[key]
      const target = current && typeof current === 'object' && !Array.isArray(current)
        ? Object.fromEntries(Object.entries(current))
        : {}
      applyEnvSchemaDefaults(target, Object.fromEntries(Object.entries(value)))
      config[key] = target
    }
    else {
      config[key] = value
    }
  }
}

function pushUnique<T>(list: T[], item: T): void {
  if (!list.includes(item))
    list.push(item)
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
    version,
    configKey: 'safeRuntimeConfig',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {
    $schema: undefined,
    requireAtBuild: false,
    validateAtBuild: undefined,
    validateAtRuntime: undefined,
    jsonSchemaTarget: 'draft-2020-12',
    onError: 'throw',
  },
  onInstall: explainNuxt5,
  onUpgrade: explainNuxt5,
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtMajorVersion = Number.parseInt(getNuxtVersion(nuxt), 10)
    const rootRequire = createRequire(join(nuxt.options.rootDir, 'package.json'))
    const nuxtPackage = rootRequire.resolve('nuxt/package.json')
    const runtimeConfigImport = resolveRuntimeConfigImport(nuxtMajorVersion >= 5 ? 3 : 2, resolveNitroParent(nuxtPackage))

    const envSchemaSource = options.envSchema
    if (envSchemaSource) {
      if (options.$schema)
        throw new Error('Choose envSchema or $schema, not both')
      if (options.validateAtRuntime === false)
        throw new Error('envSchema requires runtime validation of deployed values')
      if (options.requireAtBuild)
        throw new Error('envSchema checks deployed values when the server starts. Remove requireAtBuild.')
      const source = typeof envSchemaSource === 'string' ? { file: envSchemaSource } : envSchemaSource
      const schemaFile = resolve(nuxt.options.rootDir, source.file)
      const fields = parseEnvSchema(await readFile(schemaFile, 'utf8'), schemaFile)
      const compiled = compileEnvSchema(fields, { paths: source.paths })
      options.$schema = createEnvSchemaValidator(compiled.jsonSchema)
      applyEnvSchemaDefaults(nuxt.options.runtimeConfig, compiled.runtimeConfig)
      if (supportsNativeSchemas(nuxt))
        await registerEnvSchemaPaths(nuxtPackage, compiled.mappings.map(mapping => mapping.path))
      nuxt.hook('nitro:config', (nitroConfig) => {
        nitroConfig.runtimeConfig ||= {}
        applyEnvSchemaDefaults(nitroConfig.runtimeConfig, compiled.runtimeConfig)
      })
      nuxt.options.watch.push(schemaFile)
      nuxt.hook('builder:watch', async (_event, path) => {
        if (resolve(nuxt.options.rootDir, path) === schemaFile)
          await nuxt.callHook('restart', { hard: true })
      })
    }

    if (!options.$schema)
      return

    const validationOptions = await resolveValidationOptions(
      // envSchema never checks at build: its defaults are documentation for the deployment.
      envSchemaSource ? { ...options, buildCheck: 'off', runtimeCheck: true } : options,
      nuxt.options.rootDir,
      msg => logger.warn(msg),
    )
    const artifacts = await createRuntimeValidationArtifacts(validationOptions, msg => logger.warn(msg))
    if (!artifacts)
      return

    if (!envSchemaSource && supportsNativeSchemas(nuxt)) {
      const rejected = await registerNativeSchema(nuxtPackage, validationOptions.$schema!)
      if (rejected)
        logger.info(`Nuxt can't use this schema for useRuntimeConfig(), so only useSafeRuntimeConfig() is typed from it: ${rejected}`)
    }

    addTypeTemplate({
      filename: 'types/safe-runtime-config.d.ts',
      getContents: () => artifacts.typeDeclaration,
    })

    nuxt.hook('nitro:config', (nitroConfig) => {
      ;(nitroConfig as typeof nitroConfig & { safeRuntimeConfig: typeof validationOptions }).safeRuntimeConfig = validationOptions
      nitroConfig.alias ||= {}
      nitroConfig.alias['#safe-runtime-config/nitro-runtime-config'] = runtimeConfigImport
      nitroConfig.modules ||= []
      pushUnique(nitroConfig.modules, safeRuntimeConfigNitroModule)

      nitroConfig.typescript ||= {}
      nitroConfig.typescript.tsConfig ||= {}
      nitroConfig.typescript.tsConfig.include ||= []
      pushUnique(nitroConfig.typescript.tsConfig.include, './types/safe-runtime-config.d.ts')
    })

    addImports({ name: 'useSafeRuntimeConfig', from: resolver.resolve('./runtime/composables/useSafeRuntimeConfig') })
    addServerImports({ name: 'useSafeRuntimeConfig', from: resolver.resolve('./runtime/server/useSafeRuntimeConfig') })

    nuxt.hook('eslint:config:addons' as any, (addons: Array<{ name: string, getConfigs: () => unknown }>) => {
      addons.push({
        name: 'nuxt-safe-runtime-config',
        getConfigs: () => ({
          imports: [{ from: 'nuxt-safe-runtime-config/eslint', name: 'default', as: 'safeRuntimeConfig' }],
          configs: [`safeRuntimeConfig.configs.recommended`],
        }),
      })
    })
  },
})

declare module '@nuxt/schema' {
  interface NuxtOptions {
    _prepare?: boolean
  }
}
