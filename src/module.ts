/// <reference types="@nuxt/nitro-server" />
import type { Nuxt } from '@nuxt/schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior, ModuleOptions } from './types'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { addImports, addServerImports, addServerPlugin, addTemplate, addTypeTemplate, createResolver, defineNuxtModule, useLogger } from '@nuxt/kit'
import defu from 'defu'
import { isCI, isTest } from 'std-env'
import { version } from '../package.json'
import { generateTypeDeclaration } from './json-schema-to-ts'
import { fetchShelveSecrets, resolveShelveConfig, resolveShelveOptions } from './providers/shelve'
import { errorMessage } from './utils/error'
import { getJSONSchema } from './utils/json-schema'
import { runShelveWizard } from './wizard/shelve-setup'

export { transformEnvVars } from './runtime/utils/transform'
export type { ErrorBehavior, ModuleOptions, ShelveProviderOptions } from './types'

const logger = useLogger('safe-runtime-config')

function detectJsonSchemaDraft(schemaUri: string | undefined): string {
  if (schemaUri?.includes('2020-12'))
    return '2020-12'
  if (schemaUri?.includes('2019-09'))
    return '2019-09'
  if (schemaUri?.includes('draft-07'))
    return '7'
  return '2020-12'
}

function addNitroAlias(nuxt: Nuxt, name: string, dst: string): void {
  nuxt.hook('nitro:config', (nitroConfig) => {
    nitroConfig.alias ||= {}
    nitroConfig.alias[name] = dst
  })
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

function getRuntimeValidationPluginContents(runtimeConfigImport: string): string {
  return `import { Validator } from '@cfworker/json-schema'
import { consola } from 'consola'
import { draft, onError, schema } from '#safe-runtime-config/validate'
import { useRuntimeConfig } from ${JSON.stringify(runtimeConfigImport)}

const logger = consola.withTag('safe-runtime-config')

export default () => {
  const config = useRuntimeConfig()
  const validator = new Validator(schema, draft)
  const result = validator.validate(config)

  if (!result.valid) {
    const errors = result.errors.map(e => \`\${e.instanceLocation}: \${e.error}\`).join(', ')
    const msg = \`Runtime validation failed: \${errors}\`

    if (onError === 'throw') {
      logger.error(msg)
      throw new Error(msg)
    }
    else if (onError === 'warn') {
      logger.warn(msg)
    }
    return
  }

  logger.success('Runtime config validated (server start)')
}
`
}

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
  async onInstall(nuxt: Nuxt) {
    if (isCI || isTest || !process.stdin.isTTY || !process.stdout.isTTY)
      return
    await runShelveWizard(nuxt)
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const onError = options.onError!
    const runtimeConfigImport = resolveRuntimeConfigImport(nuxt.options.rootDir)

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
        addNitroAlias(nuxt, '#safe-runtime-config/shelve', tpl.dst)
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

    const schema = options.$schema
    const jsonSchema = await getJSONSchema(schema, options.jsonSchemaTarget, msg => logger.warn(msg))

    addTypeTemplate({
      filename: 'types/safe-runtime-config.d.ts',
      getContents: () => generateTypeDeclaration(jsonSchema),
    })
    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.typescript ||= {}
      nitroConfig.typescript.tsConfig ||= {}
      nitroConfig.typescript.tsConfig.include ||= []
      nitroConfig.typescript.tsConfig.include.push('./types/safe-runtime-config.d.ts')
    })

    if (options.validateAtBuild) {
      const run = async (): Promise<void> => validateRuntimeConfig(nuxt.options.nitro!.runtimeConfig, schema, onError)
      nuxt.hook('ready', async () => {
        if (nuxt.options._prepare)
          return
        await run()
      })
      nuxt.hook('build:done', run)
    }

    if (options.validateAtRuntime) {
      const draft = detectJsonSchemaDraft(jsonSchema.$schema as string | undefined)
      const tpl = addTemplate({
        filename: 'safe-runtime-config/validate.mjs',
        write: true,
        getContents: () => `export const schema = ${JSON.stringify(jsonSchema)}\nexport const onError = ${JSON.stringify(onError)}\nexport const draft = ${JSON.stringify(draft)}\n`,
      })
      addTemplate({
        filename: 'safe-runtime-config/validate.d.ts',
        write: true,
        getContents: () => `export declare const schema: Record<string, unknown>\nexport declare const onError: 'throw' | 'warn' | 'ignore'\nexport declare const draft: string\n`,
      })

      nuxt.options.alias['#safe-runtime-config/validate'] = tpl.dst
      addNitroAlias(nuxt, '#safe-runtime-config/validate', tpl.dst)
      const validatePlugin = addTemplate({
        filename: 'safe-runtime-config/validate-plugin.mjs',
        write: true,
        getContents: () => getRuntimeValidationPluginContents(runtimeConfigImport),
      })
      addServerPlugin(validatePlugin.dst)
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

async function validateRuntimeConfig(config: any, schema: StandardSchemaV1, onError: ErrorBehavior): Promise<void> {
  if (!isStandardSchema(schema)) {
    const msg = 'Schema is not Standard Schema compatible'
    if (onError === 'throw') {
      logger.error(msg)
      throw new Error('Invalid schema format')
    }
    else if (onError === 'warn') {
      logger.warn(msg)
    }
    return
  }

  const result = await schema['~standard'].validate(config)

  if ('issues' in result && result.issues && result.issues.length > 0) {
    const errorLines = result.issues.map((issue, index) => `  ${index + 1}. ${formatIssue(issue)}`)
    if (onError === 'throw') {
      logger.error(`Validation failed!\n${errorLines.join('\n')}`)
      throw new Error('Runtime config validation failed')
    }
    else if (onError === 'warn') {
      logger.warn(`Validation failed!\n${errorLines.join('\n')}`)
    }
    return
  }

  logger.success('Validated Runtime Config')
}

function isStandardSchema(schema: any): schema is StandardSchemaV1 {
  return schema
    && (typeof schema === 'object' || typeof schema === 'function')
    && '~standard' in schema
    && typeof schema['~standard'] === 'object'
    && typeof schema['~standard'].validate === 'function'
}

function formatIssue(issue: { path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>, message?: string }): string {
  const path = issue.path
    ? issue.path.map(p => typeof p === 'object' && p !== null && 'key' in p ? p.key : p).join('.')
    : 'root'
  return `${path}: ${issue.message || 'Validation error'}`
}
