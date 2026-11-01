/// <reference types="@nuxt/nitro-server/augments" />
import type { ModuleOptions } from './types'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { addImports, addServerImports, addTypeTemplate, createResolver, defineNuxtModule, getNuxtVersion, useLogger } from '@nuxt/kit'
import { version } from '../package.json'
import { compileEnvSchema } from './env-schema/nuxt'
import { parseEnvSchema } from './env-schema/profile'
import { createEnvSchemaValidator } from './env-schema/standard'
import safeRuntimeConfigNitroModule, { resolveRuntimeConfigImport } from './nitro'
import { createRuntimeValidationArtifacts, resolveValidationOptions } from './validation'

export type { ErrorBehavior, ModuleOptions, SchemaSource, ValidationOptions } from './types'

const logger = useLogger('safe-runtime-config')

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
    validateAtBuild: undefined,
    validateAtRuntime: undefined,
    jsonSchemaTarget: 'draft-2020-12',
    onError: 'throw',
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtMajorVersion = Number.parseInt(getNuxtVersion(nuxt), 10)
    const rootRequire = createRequire(join(nuxt.options.rootDir, 'package.json'))
    const runtimeConfigImport = resolveRuntimeConfigImport(
      nuxtMajorVersion >= 5 ? 3 : 2,
      rootRequire.resolve('nuxt/package.json'),
    )

    const envSchemaSource = options.envSchema
    if (envSchemaSource) {
      if (options.$schema)
        throw new Error('Choose envSchema or $schema, not both')
      if (options.validateAtRuntime === false)
        throw new Error('envSchema requires runtime validation of deployed values')
      const source = typeof envSchemaSource === 'string' ? { file: envSchemaSource } : envSchemaSource
      const schemaFile = resolve(nuxt.options.rootDir, source.file)
      const fields = parseEnvSchema(await readFile(schemaFile, 'utf8'), schemaFile)
      const compiled = compileEnvSchema(fields, { paths: source.paths })
      options.$schema = createEnvSchemaValidator(compiled.jsonSchema)
      options.validateAtRuntime = true
      applyEnvSchemaDefaults(nuxt.options.runtimeConfig, compiled.runtimeConfig)
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

    const validationOptions = await resolveValidationOptions(options, nuxt.options.rootDir)
    const artifacts = await createRuntimeValidationArtifacts(validationOptions, msg => logger.warn(msg))
    if (!artifacts)
      return

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

    const composable = {
      name: 'useSafeRuntimeConfig',
      from: resolver.resolve('./runtime/composables/useSafeRuntimeConfig'),
    }
    addImports(composable)
    addServerImports(composable)

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
