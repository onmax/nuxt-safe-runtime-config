import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

export type ErrorBehavior = 'throw' | 'warn' | 'ignore'

export interface ShelveProviderOptions {
  /** Enable Shelve integration. Default: false */
  enabled?: boolean
  /** Shelve project name. Fallback: SHELVE_PROJECT → package.json name */
  project?: string
  /** Shelve team slug. Fallback: SHELVE_TEAM */
  slug?: string
  /** Alias for slug */
  team?: string
  /** Environment name. Fallback: SHELVE_ENV → dev?'development':'production' */
  environment?: string
  /** Shelve API URL. Default: https://app.shelve.cloud */
  url?: string
  /** Fetch secrets at build time. Default: true */
  fetchAtBuild?: boolean
  /** Fetch secrets at runtime (cold start). Default: false */
  fetchAtRuntime?: boolean
}

export interface ModuleOptions {
  /** Standard Schema for validation (Zod, Valibot, ArkType, etc.) */
  $schema?: StandardSchemaV1
  /** Validate runtime config at build time. Default: true */
  validateAtBuild?: boolean
  /** Validate runtime config at runtime via Nitro plugin. Default: false */
  validateAtRuntime?: boolean
  /** JSON Schema target version. Default: 'draft-2020-12' */
  jsonSchemaTarget?: StandardJSONSchemaV1.Target
  /** Behavior when build-time validation fails. Default: 'throw' */
  onBuildError?: ErrorBehavior
  /** Behavior when runtime validation fails. Default: 'throw' */
  onRuntimeError?: ErrorBehavior
  /** Log success message after validation. Default: true */
  logSuccess?: boolean
  /** Log fallback warning for JSON Schema conversion. Default: true */
  logFallback?: boolean
  /** Shelve integration options */
  shelve?: boolean | ShelveProviderOptions
}

export interface EnvVar {
  key: string
  value: string
}

export type TransformedConfig = Record<string, string | Record<string, unknown>>

export interface ResolvedShelveConfig {
  project: string
  slug: string
  environment: string
  url: string
  token: string
}

export interface ShelveProject {
  id: number
  name: string
}

export interface ShelveEnvironment {
  id: number
  name: string
}
