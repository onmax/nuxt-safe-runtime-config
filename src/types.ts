import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

export type ErrorBehavior = 'throw' | 'warn' | 'ignore'
export type SchemaSource = StandardSchemaV1 | string

export interface ValidationOptions {
  /** Standard Schema or project-relative path to a default-exported schema module */
  $schema?: SchemaSource
  /**
   * Fail the build when a value is missing, not only when a value is wrong.
   * Without it, an `undefined` or `''` value at build is left for the server start check,
   * where `NUXT_*` variables fill it in. Enable it in CI that builds with every production value.
   * Default: false
   */
  requireAtBuild?: boolean
  /**
   * @deprecated The server start check always runs, and the build check skips values the deployment sets.
   * Use `requireAtBuild: true` to also require every value at build.
   */
  validateAtBuild?: boolean
  /**
   * @deprecated The server start check always runs. Remove this option.
   */
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
