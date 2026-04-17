import type { ResolvedShelveConfig, ShelveProviderOptions, TransformedConfig } from '../types'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createShelveClient, DEFAULT_URL } from '../runtime/shelve-client'
import { transformEnvVars } from '../runtime/utils/transform'

const secretsCache = new Map<string, { data: TransformedConfig, expires: number }>()
const CACHE_TTL = 30_000

function readPackageName(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath))
    return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
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

/**
 * Normalise shelve module option into a concrete options object, or null if disabled.
 * Covers: `false`/`undefined` → null, `true` → `{}`, object → as-is (respecting `enabled: false`).
 */
export function resolveShelveOptions(options: ShelveProviderOptions | boolean | undefined): ShelveProviderOptions | null {
  if (options === false || options === undefined)
    return null
  if (options === true)
    return {}
  if (options.enabled === false)
    return null
  if (options.enabled === true || options.project || options.slug || options.team)
    return options
  return null
}

/**
 * Resolve Shelve configuration from multiple sources (priority order):
 * 1. nuxt.config options
 * 2. Environment variables
 * 3. package.json (for project name only)
 */
export function resolveShelveConfig(options: ShelveProviderOptions, cwd: string, isDev: boolean): ResolvedShelveConfig {
  const project = options.project || process.env.SHELVE_PROJECT || readPackageName(cwd)
  if (!project)
    throw new Error('[safe-runtime-config] Shelve project name required. Set in nuxt.config or package.json name')

  const slug = options.slug || options.team || process.env.SHELVE_TEAM || process.env.SHELVE_TEAM_SLUG
  if (!slug)
    throw new Error('[safe-runtime-config] Shelve team slug required. Set in nuxt.config or SHELVE_TEAM env')

  const environment = options.environment || process.env.SHELVE_ENV || (isDev ? 'development' : 'production')
  const url = (options.url || process.env.SHELVE_URL || DEFAULT_URL).replace(/\/+$/, '')
  const token = process.env.SHELVE_TOKEN || getUserToken()
  if (!token)
    throw new Error('[safe-runtime-config] Shelve token required. Set SHELVE_TOKEN env or run `shelve login`')

  return { project, slug, environment, url, token }
}

export async function fetchShelveSecrets(config: ResolvedShelveConfig, useCache = true): Promise<TransformedConfig> {
  const tokenHash = createHash('sha256').update(config.token).digest('hex').slice(0, 8)
  const cacheKey = `${config.slug}:${config.project}:${config.environment}:${tokenHash}`
  if (useCache) {
    const cached = secretsCache.get(cacheKey)
    if (cached && cached.expires > Date.now())
      return cached.data
  }

  const client = createShelveClient({ token: config.token, url: config.url })

  const [project, environment] = await Promise.all([
    client.getProjectByName(config.slug, config.project).catch((error: unknown) => {
      const statusCode = (error as { statusCode?: number })?.statusCode
      if (statusCode === 400 || statusCode === 404)
        throw new Error(`[safe-runtime-config] Project '${config.project}' not found in team '${config.slug}'. Run \`shelve create ${config.project}\``)
      throw new Error(`[safe-runtime-config] Failed to fetch project: ${errorMessage(error)}`)
    }),
    client.getEnvironment(config.slug, config.environment).catch((error: unknown) => {
      throw new Error(`[safe-runtime-config] Environment '${config.environment}' not found: ${errorMessage(error)}`)
    }),
  ])
  const variables = await client.getVariables(config.slug, project.id, environment.id)
  const transformed = transformEnvVars(variables)
  secretsCache.set(cacheKey, { data: transformed, expires: Date.now() + CACHE_TTL })
  return transformed
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
