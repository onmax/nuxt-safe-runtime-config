import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { addImportsDir, addTemplate, addTypeTemplate, createResolver, defineNuxtModule, useLogger } from '@nuxt/kit'
import { toJsonSchema } from '@standard-community/standard-json'
import { generateTypeDeclaration } from './json-schema-to-ts'

const logger = useLogger('safe-runtime-config')

export type ErrorBehavior = 'throw' | 'warn' | 'ignore'

export interface ModuleOptions {
  $schema: StandardSchemaV1
  validateAtBuild: boolean
  validateAtRuntime: boolean
  jsonSchemaTarget?: StandardJSONSchemaV1.Target
  onBuildError?: ErrorBehavior
  onRuntimeError?: ErrorBehavior
  logSuccess?: boolean
  logFallback?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
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
  },
  async setup(options, nuxt) {
    if (!options.$schema)
      return

    const schema = options.$schema
    const resolver = createResolver(import.meta.url)

    // Generate JSON Schema for type generation and runtime validation
    const jsonSchema = await getJSONSchema(schema, options.jsonSchemaTarget, options.logFallback!)

    // Generate TypeScript type declarations from JSON Schema
    addTypeTemplate({
      filename: 'types/safe-runtime-config.d.ts',
      getContents: () => generateTypeDeclaration(jsonSchema),
    })

    // Build-time validation
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

    // Runtime validation via Nitro plugin
    if (options.validateAtRuntime) {
      // Generate schema for reference
      addTemplate({
        filename: 'safe-runtime-config/schema.json',
        write: true,
        getContents: () => JSON.stringify(jsonSchema),
      })

      // Detect schema draft version
      const schemaUri = jsonSchema.$schema as string | undefined
      const draft = schemaUri?.includes('2020-12')
        ? '2020-12'
        : schemaUri?.includes('2019-09')
          ? '2019-09'
          : schemaUri?.includes('draft-07') ? '7' : '2020-12'

      // Generate Nitro plugin with embedded schema
      const pluginPath = addTemplate({
        filename: 'safe-runtime-config/validate-plugin.ts',
        write: true,
        getContents: () => `
import { Validator } from '@cfworker/json-schema'
import { useRuntimeConfig } from '#imports'
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

      // Add generated plugin to Nitro
      nuxt.hook('nitro:config', (nitroConfig) => {
        nitroConfig.plugins = nitroConfig.plugins || []
        nitroConfig.plugins.push(pluginPath.dst)
      })
    }

    // Always add composable for type-safe config access
    addImportsDir(resolver.resolve('./runtime/composables'))
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

// Module augmentation for type-safe config
declare module 'nuxt/schema' {
  interface NuxtConfig {
    safeRuntimeConfig?: Partial<ModuleOptions>
  }
}
