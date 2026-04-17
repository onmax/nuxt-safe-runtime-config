import type { Nuxt } from '@nuxt/schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior, ModuleOptions } from './types'
import process from 'node:process'
import { addImports, addServerImports, addTemplate, addTypeTemplate, createResolver, defineNuxtModule, getNuxtVersion, useLogger } from '@nuxt/kit'
import defu from 'defu'
import { isCI, isTest } from 'std-env'
import { version } from '../package.json'
import { generateTypeDeclaration } from './json-schema-to-ts'
import { fetchShelveSecrets, normalizeShelveOptions, resolveShelveConfig, shouldEnableShelve } from './providers/shelve'
import { getJSONSchema } from './utils/json-schema'
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
  const hook = nuxt.hook as any
  hook('nitro:config', (nitroConfig: any) => {
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

function getNitroRuntimeImports(nuxt: Nuxt): { definePluginImport: string, runtimeConfigImport: string } {
  const major = Number.parseInt(getNuxtVersion(nuxt).split('.')[0] || '0', 10)

  if (major >= 5) {
    return {
      definePluginImport: 'import { definePlugin as defineNitroPlugin } from \'nitro\'',
      runtimeConfigImport: 'import { useRuntimeConfig } from \'nitro/runtime-config\'',
    }
  }

  return {
    definePluginImport: 'import { defineNitroPlugin } from \'nitropack/runtime/plugin\'',
    runtimeConfigImport: 'import { useRuntimeConfig } from \'nitropack/runtime/config\'',
  }
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
  async onInstall(nuxt: Nuxt) {
    if (isCI || isTest || !process.stdin.isTTY || !process.stdout.isTTY)
      return
    await runShelveWizard(nuxt)
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const cwd = nuxt.options.rootDir
    const isDev = nuxt.options.dev
    const nitroImports = getNitroRuntimeImports(nuxt)
    const hook = nuxt.hook as any

    let cachedJsonSchema: Record<string, unknown> | null = null
    const getOrCreateJsonSchema = async (): Promise<Record<string, unknown>> => {
      if (cachedJsonSchema)
        return cachedJsonSchema
      cachedJsonSchema = await getJSONSchema(
        options.$schema!,
        options.jsonSchemaTarget,
        options.logFallback ? message => logger.warn(message) : undefined,
      )
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

          const nitroOptions = (nuxt.options as any).nitro
          nuxt.options.runtimeConfig = defu(secrets, nuxt.options.runtimeConfig) as typeof nuxt.options.runtimeConfig
          nitroOptions.runtimeConfig = defu(secrets, nitroOptions.runtimeConfig)
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
${nitroImports.definePluginImport}
${nitroImports.runtimeConfigImport}
import { transformEnvVars } from '${resolver.resolve('./runtime/utils/transform')}'
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
    hook('nitro:config', (nitroConfig: any) => {
      nitroConfig.typescript = nitroConfig.typescript || {}
      nitroConfig.typescript.tsConfig = nitroConfig.typescript.tsConfig || {}
      nitroConfig.typescript.tsConfig.include = nitroConfig.typescript.tsConfig.include || []
      nitroConfig.typescript.tsConfig.include.push('./types/safe-runtime-config.d.ts')
    })

    if (options.validateAtBuild) {
      const validateOpts = { onError: options.onBuildError!, logSuccess: options.logSuccess! }
      nuxt.hook('ready', async () => {
        if ((nuxt.options as any)._prepare)
          return
        await validateRuntimeConfig((nuxt.options as any).nitro.runtimeConfig, schema, validateOpts)
      })
      nuxt.hook('build:done', async () => {
        await validateRuntimeConfig((nuxt.options as any).nitro.runtimeConfig, schema, validateOpts)
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
${nitroImports.definePluginImport}
${nitroImports.runtimeConfigImport}
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

    addImports({
      name: 'useSafeRuntimeConfig',
      from: resolver.resolve('./runtime/composables/useSafeRuntimeConfig'),
    })

    const serverComposable = addTemplate({
      filename: 'safe-runtime-config/useSafeRuntimeConfig.server.mjs',
      write: true,
      getContents: () => `
${nitroImports.runtimeConfigImport}

/**
 * @returns {NuxtSafeRuntimeConfig}
 */
export function useSafeRuntimeConfig() {
  return useRuntimeConfig()
}
`,
    })

    addTemplate({
      filename: 'safe-runtime-config/useSafeRuntimeConfig.server.d.ts',
      write: true,
      getContents: () => `
declare global {
  interface NuxtSafeRuntimeConfig {}
}

export declare function useSafeRuntimeConfig(): NuxtSafeRuntimeConfig
`,
    })

    addServerImports({
      name: 'useSafeRuntimeConfig',
      from: serverComposable.dst,
    })

    hook('eslint:config:addons', (addons: Array<{
      name: string
      getConfigs: () => { imports?: Array<{ from: string, name: string, as: string }>, configs?: string[] }
    }>) => {
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
