import type { StandardSchemaV1 } from '@standard-schema/spec'
import { defineNuxtModule } from '@nuxt/kit'

export interface ModuleOptions {
  $schema: StandardSchemaV1
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
    configKey: 'safeRuntimeConfig',
  },
  defaults: {
    $schema: undefined,
  },
  setup(options, nuxt) {
    if (!options.$schema)
      return

    const schema = options.$schema

    // Validate during Nitro initialization (after env vars are merged)
    // Using nitro:init ensures errors block the build
    nuxt.hook('nitro:init', async (nitro) => {
      await validateRuntimeConfig(nitro.options.runtimeConfig, schema)
    })
  },
})

async function validateRuntimeConfig(config: any, schema: StandardSchemaV1): Promise<void> {
  if (!isStandardSchema(schema)) {
    console.error('Safe Runtime Config: Schema is not Standard Schema compatible')
    throw new Error('Invalid schema format')
  }

  const result = await schema['~standard'].validate(config)

  if ('issues' in result && result.issues && result.issues.length > 0) {
    console.error('Safe Runtime Config: Validation failed!')
    result.issues.forEach((issue: any, index: number) => {
      console.error(`  ${index + 1}. ${formatIssue(issue)}`)
    })
    throw new Error('Runtime config validation failed')
  }

  // eslint-disable-next-line no-console
  console.log('✓ Validated Runtime Config')
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
