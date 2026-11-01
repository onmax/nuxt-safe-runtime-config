import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

export type ErrorBehavior = 'throw' | 'warn' | 'ignore'
export type SchemaSource = StandardSchemaV1 | string

export interface ValidationOptions {
  /** Standard Schema or project-relative path to a default-exported schema module */
  $schema?: SchemaSource
  /** Validate runtime config at build time. Default: `true`, or `false` when `validateAtRuntime` is enabled */
  validateAtBuild?: boolean
  /** Validate runtime config when the server starts, coercing env overrides against the schema. Default: false */
  validateAtRuntime?: boolean
  /** JSON Schema target version. Default: 'draft-2020-12' */
  jsonSchemaTarget?: StandardJSONSchemaV1.Target
  /** Behavior when validation fails. Default: 'throw' */
  onError?: ErrorBehavior
}

export interface ModuleOptions extends ValidationOptions {
  /** Committed env-spec schema. Values are validated at runtime without requiring build secrets. */
  envSchema?: string | {
    file: string
    /** Explicit nested paths. Each path must match the declared canonical NUXT_ name. */
    paths?: Record<string, string>
  }
}

declare module 'nitro/types' {
  interface NitroConfig {
    safeRuntimeConfig?: ValidationOptions
  }
  interface NitroOptions {
    safeRuntimeConfig?: ValidationOptions
  }
}

declare module 'nitropack/types' {
  interface NitroConfig {
    safeRuntimeConfig?: ValidationOptions
  }
  interface NitroOptions {
    safeRuntimeConfig?: ValidationOptions
  }
}
