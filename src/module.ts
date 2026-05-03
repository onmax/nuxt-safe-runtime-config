/// <reference types="@nuxt/nitro-server" />
import type { ModuleOptions } from './types'
import process from 'node:process'
import { addImports, addServerImports, addServerPlugin, addTemplate, addTypeTemplate, createResolver, defineNuxtModule, useLogger } from '@nuxt/kit'
import defu from 'defu'
import { isCI, isTest } from 'std-env'
import { version } from '../package.json'
import { resolveRuntimeConfigImport, RUNTIME_PLUGIN_PATH } from './nitro'
import { fetchShelveSecrets, resolveShelveConfig, resolveShelveOptions } from './providers/shelve'
import { errorMessage } from './utils/error'
import { createRuntimeValidationArtifacts, resolveValidationOptions, validateRuntimeConfig } from './validation'
import { runShelveWizard } from './wizard/shelve-setup'

export { transformEnvVars } from './runtime/utils/transform'
export type { ErrorBehavior, ModuleOptions, ShelveProviderOptions, ValidationOptions } from './types'

const logger = useLogger('safe-runtime-config')

function getShelveRuntimePluginContents(
  shelveClientPath: string,
  transformPath: string,
  runtimeConfigImport: string,
): string {
  return `import process from 'node:process'
import { shelveRuntimeConfig } from '#safe-runtime-config/shelve'
import { consola } from 'consola'
import defu from 'defu'
import { createShelveClient } from ${JSON.stringify(shelveClientPath)}
import { transformEnvVars } from ${JSON.stringify(transformPath)}
import { useRuntimeConfig } from ${JSON.stringify(runtimeConfigImport)}

const logger = consola.withTag('safe-runtime-config')

export default async () => {
  const cfg = shelveRuntimeConfig
  const token = process.env.SHELVE_TOKEN
  if (!token) {
    logger.warn('SHELVE_TOKEN not set, skipping runtime secrets fetch')
    return
  }

  const client = createShelveClient({ token, url: cfg.url })

  try {
    const [project, environment] = await Promise.all([
      client.getProjectByName(cfg.slug, cfg.project),
      client.getEnvironment(cfg.slug, cfg.environment),
    ])
    const variables = await client.getVariables(cfg.slug, project.id, environment.id)

    if (variables.length === 0) {
      logger.info('No Shelve variables found')
      return
    }

    const secrets = transformEnvVars(variables)
    const config = useRuntimeConfig()
    Object.assign(config, defu(secrets, config))
    logger.success(\`Loaded \${variables.length} secrets from Shelve (runtime)\`)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(\`Failed to fetch Shelve secrets: \${msg}\`)
  }
}
`
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
    validateAtBuild: true,
    validateAtRuntime: false,
    jsonSchemaTarget: 'draft-2020-12',
    onError: 'throw',
    shelve: undefined,
  },
  // onInstall: Nuxt 4.1+, ignored on older versions
  async onInstall(nuxt) {
    if (isCI || isTest || !process.stdin.isTTY || !process.stdout.isTTY)
      return
    await runShelveWizard(nuxt)
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const onError = options.onError!
    const runtimeConfigImport = resolveRuntimeConfigImport()

    const shelveOpts = resolveShelveOptions(options.shelve)
    if (shelveOpts) {
      const fetchAtBuild = shelveOpts.fetchAtBuild !== false
      let shelveConfig: Awaited<ReturnType<typeof resolveShelveConfig>> | null = null

      try {
        shelveConfig = resolveShelveConfig(shelveOpts, nuxt.options.rootDir, nuxt.options.dev)
      }
      catch (error) {
        logger.warn(`Shelve config resolution failed: ${errorMessage(error)}`)
      }

      if (fetchAtBuild && shelveConfig) {
        try {
          const secrets = await fetchShelveSecrets(shelveConfig)
          nuxt.options.runtimeConfig = defu(secrets, nuxt.options.runtimeConfig) as typeof nuxt.options.runtimeConfig
          nuxt.options.nitro!.runtimeConfig = defu(secrets, nuxt.options.nitro!.runtimeConfig)
          logger.success(`Loaded ${Object.keys(secrets).length} secrets from Shelve (${shelveConfig.environment})`)
        }
        catch (error) {
          logger.error(errorMessage(error))
          if (onError === 'throw')
            throw error
        }
      }

      if (shelveOpts.fetchAtRuntime && shelveConfig) {
        const tpl = addTemplate({
          filename: 'safe-runtime-config/shelve.mjs',
          write: true,
          getContents: () => `export const shelveRuntimeConfig = ${JSON.stringify({
            url: shelveConfig!.url,
            slug: shelveConfig!.slug,
            project: shelveConfig!.project,
            environment: shelveConfig!.environment,
          })}\n`,
        })
        addTemplate({
          filename: 'safe-runtime-config/shelve.d.ts',
          write: true,
          getContents: () => `export declare const shelveRuntimeConfig: { url: string, slug: string, project: string, environment: string }\n`,
        })

        nuxt.options.alias['#safe-runtime-config/shelve'] = tpl.dst
        nuxt.hook('nitro:config', (nitroConfig) => {
          nitroConfig.alias ||= {}
          nitroConfig.alias['#safe-runtime-config/shelve'] = tpl.dst
        })
        const shelvePlugin = addTemplate({
          filename: 'safe-runtime-config/shelve-plugin.mjs',
          write: true,
          getContents: () => getShelveRuntimePluginContents(
            resolver.resolve('./runtime/shelve-client'),
            resolver.resolve('./runtime/utils/transform'),
            runtimeConfigImport,
          ),
        })
        addServerPlugin(shelvePlugin.dst)
      }
    }

    if (!options.$schema)
      return

    const validationOptions = resolveValidationOptions(options)
    const artifacts = await createRuntimeValidationArtifacts(validationOptions, msg => logger.warn(msg))
    if (!artifacts)
      return

    addTypeTemplate({
      filename: 'types/safe-runtime-config.d.ts',
      getContents: () => artifacts.typeDeclaration,
    })

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.typescript ||= {}
      nitroConfig.typescript.tsConfig ||= {}
      nitroConfig.typescript.tsConfig.include ||= []
      nitroConfig.typescript.tsConfig.include.push('./types/safe-runtime-config.d.ts')
    })

    if (validationOptions.validateAtRuntime) {
      const tpl = addTemplate({
        filename: 'safe-runtime-config/validate.mjs',
        write: true,
        getContents: () => artifacts.validateTemplate,
      })
      addTemplate({
        filename: 'safe-runtime-config/validate.d.ts',
        write: true,
        getContents: () => artifacts.validateTemplateDeclaration,
      })

      nuxt.options.alias['#safe-runtime-config/validate'] = tpl.dst
      nuxt.hook('nitro:config', (nitroConfig) => {
        nitroConfig.alias ||= {}
        nitroConfig.alias['#safe-runtime-config/validate'] = tpl.dst
        nitroConfig.alias['#safe-runtime-config/nitro-runtime-config'] = runtimeConfigImport
      })
      addServerPlugin(RUNTIME_PLUGIN_PATH)
    }

    if (validationOptions.validateAtBuild) {
      const run = async (): Promise<void> => validateRuntimeConfig(
        nuxt.options.nitro!.runtimeConfig,
        validationOptions.$schema!,
        validationOptions.onError,
        logger,
      )
      nuxt.hook('ready', async () => {
        if (nuxt.options._prepare)
          return
        await run()
      })
      nuxt.hook('build:done', run)
    }

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
