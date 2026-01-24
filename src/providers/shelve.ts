import type { EnvVar, ResolvedShelveConfig, ShelveEnvironment, ShelveProject, ShelveProviderOptions, TransformedConfig } from '../types'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { $fetch } from 'ofetch'
import { DEFAULT_URL, getErrorMessage } from '../utils/shared'
import { transformEnvVars } from '../utils/transform'

// Dev-mode cache: 30s TTL to avoid re-fetching on every HMR
const secretsCache = new Map<string, { data: TransformedConfig, expires: number }>()
const CACHE_TTL = 30_000

interface PackageJson {
  name?: string
}

function getStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return (error as { statusCode?: number }).statusCode
  }
  return undefined
}

function getPackageName(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath))
    return null
  try {
    const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.name || null
  }
  catch {
    return null
  }
}

export function getUserToken(): string | null {
  const shelveRcPath = join(homedir(), '.shelve')
  if (!existsSync(shelveRcPath))
    return null
  try {
    const content = readFileSync(shelveRcPath, 'utf-8')
    const match = content.match(/^token\s*=\s*["']?([^"'\r\n]+)["']?/m)
    return match?.[1]?.trim() || null
  }
  catch {
    return null
  }
}

export function clearSecretsCache(): void {
  secretsCache.clear()
}

export function shouldEnableShelve(options: ShelveProviderOptions | boolean | undefined): boolean {
  if (options === false || options === undefined)
    return false
  if (options === true)
    return true
  if (typeof options === 'object') {
    if (options.enabled === false)
      return false
    return options.enabled === true || !!(options.project || options.slug || options.team)
  }
  return false
}

/**
 * Resolve Shelve configuration from multiple sources (priority order):
 * 1. nuxt.config options
 * 2. Environment variables
 * 3. package.json (for project name only)
 */
export function resolveShelveConfig(options: ShelveProviderOptions, cwd: string, isDev: boolean): ResolvedShelveConfig {
  const project = options.project
    || process.env.SHELVE_PROJECT
    || getPackageName(cwd)
  if (!project)
    throw new Error('[safe-runtime-config] Shelve project name required. Set in nuxt.config or package.json name')

  const slug = options.slug
    || options.team
    || process.env.SHELVE_TEAM
    || process.env.SHELVE_TEAM_SLUG
  if (!slug)
    throw new Error('[safe-runtime-config] Shelve team slug required. Set in nuxt.config or SHELVE_TEAM env')

  const environment = options.environment
    || process.env.SHELVE_ENV
    || (isDev ? 'development' : 'production')

  const url = options.url
    || process.env.SHELVE_URL
    || DEFAULT_URL

  const token = process.env.SHELVE_TOKEN || getUserToken()
  if (!token)
    throw new Error('[safe-runtime-config] Shelve token required. Set SHELVE_TOKEN env or run `shelve login`')

  return { project, slug, environment, url: url.replace(/\/+$/, ''), token }
}

function createAuthHeaders(token: string): { Cookie: string } {
  return { Cookie: `authToken=${token}` }
}

async function fetchProject(config: ResolvedShelveConfig): Promise<ShelveProject> {
  const url = `${config.url}/api/teams/${config.slug}/projects/name/${encodeURIComponent(config.project)}`

  try {
    return await $fetch<ShelveProject>(url, {
      headers: createAuthHeaders(config.token),
    })
  }
  catch (error: unknown) {
    const statusCode = getStatusCode(error)
    if (statusCode === 400 || statusCode === 404) {
      throw new Error(`[safe-runtime-config] Project '${config.project}' not found in team '${config.slug}'. Run \`shelve create ${config.project}\``)
    }
    throw new Error(`[safe-runtime-config] Failed to fetch project: ${getErrorMessage(error)}`)
  }
}

async function fetchEnvironment(config: ResolvedShelveConfig): Promise<ShelveEnvironment> {
  const url = `${config.url}/api/teams/${config.slug}/environments/${config.environment}`

  try {
    return await $fetch<ShelveEnvironment>(url, {
      headers: createAuthHeaders(config.token),
    })
  }
  catch (error: unknown) {
    throw new Error(`[safe-runtime-config] Environment '${config.environment}' not found: ${getErrorMessage(error)}`)
  }
}

async function fetchVariables(config: ResolvedShelveConfig, projectId: number, environmentId: number): Promise<EnvVar[]> {
  const url = `${config.url}/api/teams/${config.slug}/projects/${projectId}/variables/env/${environmentId}`

  return await $fetch<EnvVar[]>(url, {
    headers: createAuthHeaders(config.token),
  })
}

export async function fetchShelveSecrets(config: ResolvedShelveConfig, useCache = true): Promise<TransformedConfig> {
  const tokenHash = createHash('sha256').update(config.token).digest('hex').slice(0, 8)
  const cacheKey = `${config.slug}:${config.project}:${config.environment}:${tokenHash}`
  if (useCache) {
    const cached = secretsCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      return cached.data
    }
  }

  const project = await fetchProject(config)
  const environment = await fetchEnvironment(config)
  const variables = await fetchVariables(config, project.id, environment.id)
  const transformed = transformEnvVars(variables)
  secretsCache.set(cacheKey, { data: transformed, expires: Date.now() + CACHE_TTL })

  return transformed
}

export function normalizeShelveOptions(options: boolean | ShelveProviderOptions | undefined): ShelveProviderOptions {
  if (options === true || options === undefined)
    return {}
  if (options === false)
    return { enabled: false }
  return options
}
