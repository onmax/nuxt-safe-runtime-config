declare module '#safe-runtime-config/nitro-runtime-config' {
  export function useRuntimeConfig(): Record<string, unknown>
}

declare module '#safe-runtime-config/validate' {
  import type { Schema, SchemaDraft } from '@cfworker/json-schema'
  import type { StandardSchemaV1 } from '@standard-schema/spec'

  export const runtimeSchema: StandardSchemaV1 | null
  export const schema: Schema
  export const onError: 'throw' | 'warn' | 'ignore'
  export const draft: SchemaDraft
}

declare module '#safe-runtime-config/shelve' {
  export const shelveRuntimeConfig: {
    environment: string
    project: string
    slug: string
    url: string
  }
}
