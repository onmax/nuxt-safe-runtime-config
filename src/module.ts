import type { Nuxt } from '@nuxt/schema'
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior, ModuleOptions } from './types'
import { addImportsDir, addServerImportsDir, addTemplate, addTypeTemplate, createResolver, defineNuxtModule, useLogger } from '@nuxt/kit'
import { toJsonSchema } from '@standard-community/standard-json'
import defu from 'defu'
import { isCI, isTest } from 'std-env'
import { version } from '../package.json'
import { generateTypeDeclaration } from './json-schema-to-ts'
import { fetchShelveSecrets, normalizeShelveOptions, resolveShelveConfig, shouldEnableShelve } from './providers/shelve'
import { getErrorMessage } from './utils/shared'
import { runShelveWizard } from './wizard/shelve-setup'

export type { ErrorBehavior, ModuleOptions, ShelveProviderOptions } from './types'
export { transformEnvVars } from './utils/transform'

function countConfigKeys(secrets: Record<string, unknown>): number {
  return Object.keys(secrets).reduce((acc, k) => {
    const v = secrets[k]
    return acc + (v && typeof v === 'object' ? Object.keys(v as Record<string, unknown>).length : 1)
  }, 0)
}

function registerNitroPlugin(nuxt: Nuxt, pluginPath: string): void {
  nuxt.hook('nitro:config', (nitroConfig) => {
    nitroConfig.plugins = nitroConfig.plugins || []
    nitroConfig.plugins.push(pluginPath)
  })
}

function detectJsonSchemaDraft(schemaUri: string | undefined): string {
  if (schemaUri?.includes('2020-12'))
    return '2020-12'
  if (schemaUri?.includes('2019-09'))
    return '2019-09'
  if (schemaUri?.includes('draft-07'))
    return '7'
  return '2020-12'
}

const logger = useLogger('safe-runtime-config')

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
    onBuildError: 'throw',
    onRuntimeError: 'throw',
    logSuccess: true,
    logFallback: true,
    shelve: undefined,
  },
  // onInstall requires Nuxt 4.1+ - ignored on older versions
  // @ts-expect-error onInstall is Nuxt 4.1+ feature
  async onInstall(nuxt: Nuxt) {
    if (isCI || isTest)
      return
    await runShelveWizard(nuxt)
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const cwd = nuxt.options.rootDir
    const isDev = nuxt.options.dev

    let cachedJsonSchema: Record<string, unknown> | null = null
    const getOrCreateJsonSchema = async (): Promise<Record<string, unknown>> => {
      if (cachedJsonSchema)
        return cachedJsonSchema
      cachedJsonSchema = await getJSONSchema(options.$schema!, options.jsonSchemaTarget, options.logFallback!)
      return cachedJsonSchema
    }

    let shelveConfig: Awaited<ReturnType<typeof resolveShelveConfig>> | null = null
    if (shouldEnableShelve(options.shelve)) {
      const shelveOpts = normalizeShelveOptions(options.shelve!)
      const fetchAtBuild = shelveOpts.fetchAtBuild !== false

      if (fetchAtBuild) {
        try {
          shelveConfig = resolveShelveConfig(shelveOpts, cwd, isDev)
          const secrets = await fetchShelveSecrets(shelveConfig)
          const varCount = countConfigKeys(secrets)

          nuxt.options.runtimeConfig = defu(secrets, nuxt.options.runtimeConfig) as typeof nuxt.options.runtimeConfig
          nuxt.options.nitro.runtimeConfig = defu(secrets, nuxt.options.nitro.runtimeConfig)
          logger.success(`Loaded ${varCount} secrets from Shelve (${shelveConfig.environment})`)
        }
        catch (error: unknown) {
          logger.error(getErrorMessage(error))
          if (options.onBuildError === 'throw')
            throw error
        }
      }
      else {
        try {
          shelveConfig = resolveShelveConfig(shelveOpts, cwd, isDev)
        }
        catch (error: unknown) {
          logger.warn(`Shelve config resolution failed: ${getErrorMessage(error)}`)
        }
      }

      if (shelveOpts.fetchAtRuntime && shelveConfig) {
        addServerImportsDir(resolver.resolve('./runtime/utils'))

        const configJson = JSON.stringify({
          url: shelveConfig.url,
          slug: shelveConfig.slug,
          project: shelveConfig.project,
          environment: shelveConfig.environment,
        })

        const pluginPath = addTemplate({
          filename: 'safe-runtime-config/shelve-plugin.ts',
          write: true,
          getContents: () => `
import { $fetch } from 'ofetch'
import defu from 'defu'
import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import { transformEnvVars } from '#imports'
import { consola } from 'consola'

const logger = consola.withTag('safe-runtime-config')
const shelveConfig = ${configJson}

interface EnvVar { key: string, value: string }
interface ShelveProject { id: number }
interface ShelveEnvironment { id: number }

export default defineNitroPlugin(async () => {
  const token = process.env.SHELVE_TOKEN
  if (!token) {
    logger.warn('SHELVE_TOKEN not set, skipping runtime secrets fetch')
    return
  }

  const headers = { Cookie: 'authToken=' + token }

  try {
    const project = await $fetch<ShelveProject>(
      shelveConfig.url + '/api/teams/' + shelveConfig.slug + '/projects/name/' + encodeURIComponent(shelveConfig.project),
      { headers }
    )
    const environment = await $fetch<ShelveEnvironment>(
      shelveConfig.url + '/api/teams/' + shelveConfig.slug + '/environments/' + shelveConfig.environment,
      { headers }
    )
    const variables = await $fetch<EnvVar[]>(
      shelveConfig.url + '/api/teams/' + shelveConfig.slug + '/projects/' + project.id + '/variables/env/' + environment.id,
      { headers }
    )

    if (variables.length === 0) {
      logger.info('No Shelve variables found')
      return
    }

    const secrets = transformEnvVars(variables)
    const config = useRuntimeConfig()
    Object.assign(config, defu(secrets, config))
    logger.success('Loaded ' + variables.length + ' secrets from Shelve (runtime)')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to fetch Shelve secrets: ' + msg)
  }
})
`,
        })

        registerNitroPlugin(nuxt, pluginPath.dst)
      }
    }

    if (!options.$schema)
      return

    const schema = options.$schema
    const jsonSchema = await getOrCreateJsonSchema()

    addTypeTemplate({
      filename: 'types/safe-runtime-config.d.ts',
      getContents: () => generateTypeDeclaration(jsonSchema),
    })

    if (options.validateAtBuild) {
      const validateOpts = { onError: options.onBuildError!, logSuccess: options.logSuccess! }
      nuxt.hook('ready', async () => {
        if ((nuxt.options as any)._prepare)
          return
        await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema, validateOpts)
      })
      nuxt.hook('build:done', async () => {
        await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema, validateOpts)
      })
    }

    if (options.validateAtRuntime) {
      addTemplate({
        filename: 'safe-runtime-config/schema.json',
        write: true,
        getContents: () => JSON.stringify(jsonSchema),
      })

      const draft = detectJsonSchemaDraft(jsonSchema.$schema as string | undefined)

      const pluginPath = addTemplate({
        filename: 'safe-runtime-config/validate-plugin.ts',
        write: true,
        getContents: () => `
import { Validator } from '@cfworker/json-schema'
import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import { consola } from 'consola'

const logger = consola.withTag('safe-runtime-config')
const schema = ${JSON.stringify(jsonSchema)}
const options = ${JSON.stringify({ onError: options.onRuntimeError, logSuccess: options.logSuccess })}

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const validator = new Validator(schema, '${draft}')
  const result = validator.validate(config)

  if (!result.valid) {
    const errors = result.errors.map(e => \`\${e.instanceLocation}: \${e.error}\`).join(', ')
    const msg = \`Runtime validation failed: \${errors}\`

    if (options.onError === 'throw') {
      logger.error(msg)
      throw new Error(msg)
    } else if (options.onError === 'warn') {
      logger.warn(msg)
    }
  } else if (options.logSuccess) {
    logger.success('Runtime config validated (server start)')
  }
})
`,
      })

      registerNitroPlugin(nuxt, pluginPath.dst)
    }

    addImportsDir(resolver.resolve('./runtime/composables'))

    nuxt.hook('eslint:config:addons', (addons) => {
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

function hasNativeJSONSchema(schema: StandardSchemaV1): boolean {
  return typeof (schema?.['~standard'] as any)?.jsonSchema?.output === 'function'
}

async function getJSONSchema(schema: StandardSchemaV1, target: StandardJSONSchemaV1.Target = 'draft-2020-12', logFallback = true): Promise<Record<string, unknown>> {
  if (hasNativeJSONSchema(schema)) {
    try {
      return (schema['~standard'] as any).jsonSchema.output({ target })
    }
    catch {
      if (logFallback)
        logger.warn(`Native JSON Schema failed for target "${target}", using fallback`)
    }
  }
  if (logFallback)
    logger.warn('Schema does not support native JSON Schema, using @standard-community/standard-json fallback')
  return await toJsonSchema(schema as any) as Record<string, unknown>
}

interface ValidateOptions {
  onError: ErrorBehavior
  logSuccess: boolean
}

async function validateRuntimeConfig(config: any, schema: StandardSchemaV1, opts: ValidateOptions): Promise<void> {
  if (!isStandardSchema(schema)) {
    const msg = 'Schema is not Standard Schema compatible'
    if (opts.onError === 'throw') {
      logger.error(msg)
      throw new Error('Invalid schema format')
    }
    else if (opts.onError === 'warn') {
      logger.warn(msg)
    }
    return
  }

  const result = await schema['~standard'].validate(config)

  if ('issues' in result && result.issues && result.issues.length > 0) {
    const errorLines = result.issues.map((issue: any, index: number) => `  ${index + 1}. ${formatIssue(issue)}`)

    if (opts.onError === 'throw') {
      logger.error(`Validation failed!\n${errorLines.join('\n')}`)
      throw new Error('Runtime config validation failed')
    }
    else if (opts.onError === 'warn') {
      logger.warn(`Validation failed!\n${errorLines.join('\n')}`)
    }
    return
  }

  if (opts.logSuccess)
    logger.success('Validated Runtime Config')
}

function isStandardSchema(schema: any): schema is StandardSchemaV1 {
  return schema
    && typeof schema === 'object'
    && '~standard' in schema
    && typeof schema['~standard'] === 'object'
    && typeof schema['~standard'].validate === 'function'
}

function formatIssue(issue: any): string {
  const path = issue.path
    ? issue.path.map((p: any) => p && typeof p === 'object' && 'key' in p ? p.key : p).join('.')
    : 'root'
  return `${path}: ${issue.message || 'Validation error'}`
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    'eslint:config:addons': (addons: Array<{
      name: string
      getConfigs: () => { imports?: Array<{ from: string, name: string, as: string }>, configs?: string[] }
    }>) => void
  }
}
