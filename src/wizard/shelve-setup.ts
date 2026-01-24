import type { Nuxt } from '@nuxt/schema'
import type { ConsolaInstance } from 'consola'
import { exec } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { consola } from 'consola'
import { builders, loadFile, writeFile } from 'magicast'
import { getDefaultExportOptions } from 'magicast/helpers'
import { $fetch } from 'ofetch'
import { DEFAULT_URL, getErrorMessage } from '../utils/shared'
import { getPrefix, toCamelCase } from '../utils/transform'

const execAsync = promisify(exec)

const SHELVE_RC_PATH = join(homedir(), '.shelve')

type ValidationLibrary = 'valibot' | 'zod'

interface ShelveUser { username: string, email: string }
interface ShelveTeam { slug: string, name: string }
interface ShelveProject { id: number, name: string }
interface ShelveEnvironment { id: number, name: string }
interface ShelveVariable { key: string, value: string }

async function fetchTeams(token: string, url = DEFAULT_URL): Promise<ShelveTeam[]> {
  try {
    return await $fetch<ShelveTeam[]>(`${url}/api/teams`, { headers: { Cookie: `authToken=${token}` } })
  }
  catch {
    return []
  }
}

function readShelveRc(): Record<string, string> {
  if (!existsSync(SHELVE_RC_PATH))
    return {}
  try {
    const content = readFileSync(SHELVE_RC_PATH, 'utf-8')
    const result: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+)\s*=\s*["']?([^"'\r\n]+)["']?/)
      if (match?.[1] && match[2])
        result[match[1]] = match[2].trim()
    }
    return result
  }
  catch { return {} }
}

function writeShelveRc(data: Record<string, string>): void {
  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`)
  writeFileSync(SHELVE_RC_PATH, `${lines.join('\n')}\n`, { mode: 0o600 })
}

async function validateToken(token: string, url = DEFAULT_URL): Promise<ShelveUser | null> {
  try {
    return await $fetch<ShelveUser>(`${url}/api/user/me`, { headers: { Cookie: `authToken=${token}` } })
  }
  catch {
    return null
  }
}

async function fetchProjects(token: string, url: string, slug: string): Promise<ShelveProject[]> {
  return await $fetch<ShelveProject[]>(`${url}/api/teams/${slug}/projects`, { headers: { Cookie: `authToken=${token}` } })
}

async function fetchEnvironment(token: string, url: string, slug: string, env: string): Promise<ShelveEnvironment> {
  return await $fetch<ShelveEnvironment>(`${url}/api/teams/${slug}/environments/${env}`, { headers: { Cookie: `authToken=${token}` } })
}

async function fetchVariables(token: string, url: string, slug: string, projectId: number, envId: number): Promise<ShelveVariable[]> {
  return await $fetch<ShelveVariable[]>(`${url}/api/teams/${slug}/projects/${projectId}/variables/env/${envId}`, { headers: { Cookie: `authToken=${token}` } })
}

function detectValidationLibrary(rootDir: string): ValidationLibrary | null {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath))
    return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const hasValibot = 'valibot' in deps
    const hasZod = 'zod' in deps
    if (hasValibot && !hasZod)
      return 'valibot'
    if (hasZod && !hasValibot)
      return 'zod'
    return null // 0 or 2+ installed → ask user
  }
  catch { return null }
}

function detectPackageManager(rootDir: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(rootDir, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (existsSync(join(rootDir, 'yarn.lock')))
    return 'yarn'
  return 'npm'
}

async function installValidationLibrary(rootDir: string, library: ValidationLibrary, logger: ConsolaInstance): Promise<void> {
  const pm = detectPackageManager(rootDir)
  const packages = library === 'valibot'
    ? ['valibot', '@valibot/to-json-schema']
    : ['zod']

  const cmd = pm === 'npm'
    ? `npm install ${packages.join(' ')}`
    : `${pm} add ${packages.join(' ')}`

  logger.info(`Installing ${packages.join(', ')}...`)
  try {
    await execAsync(cmd, { cwd: rootDir })
    logger.success(`Installed ${library} dependencies`)
  }
  catch (error) {
    logger.error(`Failed to install dependencies: ${error}`)
  }
}

function countPrefixes(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const prefix = getPrefix(key)
    if (prefix)
      counts.set(prefix, (counts.get(prefix) || 0) + 1)
  }
  return counts
}

/** Strip Nuxt-specific prefixes from env var keys */
function stripNuxtPrefix(key: string): { key: string, isPublic: boolean } {
  if (key.startsWith('NUXT_PUBLIC_'))
    return { key: key.slice(12), isPublic: true }
  if (key.startsWith('PUBLIC_'))
    return { key: key.slice(7), isPublic: true }
  if (key.startsWith('NUXT_'))
    return { key: key.slice(5), isPublic: false }
  return { key, isPublic: false }
}

/** Transform env var keys into nested runtimeConfig structure */
function transformKeysToStructure(keys: string[]): Record<string, Record<string, true> | true> {
  // First, normalize keys by stripping NUXT_ prefixes
  const normalizedKeys = keys.map((k) => {
    const { key, isPublic } = stripNuxtPrefix(k)
    return { original: k, normalized: key, isPublic }
  })

  // Count prefixes on normalized keys
  const prefixCounts = countPrefixes(normalizedKeys.map(k => k.normalized))
  const result: Record<string, Record<string, true> | true> = {}

  for (const { normalized, isPublic } of normalizedKeys) {
    if (isPublic) {
      result.public ??= {}
      assignNestedKey(result.public as Record<string, true>, normalized, prefixCounts)
      continue
    }

    const prefix = getPrefix(normalized)
    if (prefix && (prefixCounts.get(prefix) || 0) >= 2) {
      const groupKey = toCamelCase(prefix)
      result[groupKey] ??= {}
      const nestedKey = toCamelCase(normalized.slice(prefix.length + 1))
      ;(result[groupKey] as Record<string, true>)[nestedKey] = true
    }
    else {
      result[toCamelCase(normalized)] = true
    }
  }

  return result
}

function assignNestedKey(obj: Record<string, true | Record<string, true>>, key: string, prefixCounts: Map<string, number>): void {
  const prefix = getPrefix(key)
  if (prefix && (prefixCounts.get(prefix) || 0) >= 2) {
    const groupKey = toCamelCase(prefix)
    obj[groupKey] ??= {}
    const rest = key.slice(prefix.length + 1)
    const nestedKey = toCamelCase(rest)
    ;(obj[groupKey] as Record<string, true>)[nestedKey] = true
  }
  else {
    obj[toCamelCase(key)] = true
  }
}

function generateSchemaCode(keys: string[] | null, library: ValidationLibrary): { imports: string, schemaExpr: string } {
  const s = library === 'valibot' ? 'v.string()' : 'z.string()'
  const o = library === 'valibot' ? 'v.object' : 'z.object'
  const imports = library === 'valibot' ? `import * as v from 'valibot'` : `import { z } from 'zod'`

  if (!keys || keys.length === 0) {
    // Placeholder schema
    return { imports, schemaExpr: `${o}({})` }
  }

  const structure = transformKeysToStructure(keys)

  function renderObject(obj: Record<string, true | Record<string, true>>, indent = 2): string {
    const entries = Object.entries(obj)
    if (entries.length === 0)
      return '{}'
    const pad = ' '.repeat(indent)
    const closePad = ' '.repeat(indent - 2)
    const lines = entries.map(([k, v]) => {
      if (v === true)
        return `${pad}${k}: ${s},`
      // Nested object - render inline if small, multiline if large
      const nestedKeys = Object.keys(v)
      if (nestedKeys.length <= 2) {
        return `${pad}${k}: ${o}({ ${nestedKeys.map(nk => `${nk}: ${s}`).join(', ')} }),`
      }
      const nestedPad = ' '.repeat(indent + 2)
      const nestedLines = nestedKeys.map(nk => `${nestedPad}${nk}: ${s},`)
      return `${pad}${k}: ${o}({\n${nestedLines.join('\n')}\n${pad}}),`
    })
    return `{\n${lines.join('\n')}\n${closePad}}`
  }

  return { imports, schemaExpr: `${o}(${renderObject(structure)})` }
}

function findNuxtConfig(rootDir: string): string | null {
  const names = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mts', 'nuxt.config.mjs']
  for (const name of names) {
    const path = resolve(rootDir, name)
    if (existsSync(path))
      return path
  }
  return null
}

interface UpdateNuxtConfigOptions {
  schema: { imports: string, schemaExpr: string } | null
  shelve: { project: string, slug: string } | null
  logger: ConsolaInstance
}

async function updateNuxtConfig(rootDir: string, options: UpdateNuxtConfigOptions): Promise<boolean> {
  const { logger } = options
  const configPath = findNuxtConfig(rootDir)
  if (!configPath) {
    logger.warn('Could not find nuxt.config file')
    return false
  }

  try {
    // If we have a schema, add imports at the top of the file
    if (options.schema) {
      let content = readFileSync(configPath, 'utf-8')

      // Check if $schema already exists
      if (content.includes('$schema')) {
        logger.info('Schema already exists in nuxt.config, skipping schema generation')
      }
      else {
        // Check if import already exists
        const importStatement = options.schema.imports
        if (!content.includes(importStatement)) {
          // Add imports at the top (after any existing imports)
          const importMatch = content.match(/^(import[\s\S]*?(?:\n(?!import)|\n$))/m)
          if (importMatch) {
            const lastImportEnd = importMatch.index! + importMatch[0].length
            content = `${content.slice(0, lastImportEnd)}${importStatement}\n${content.slice(lastImportEnd)}`
          }
          else {
            // No imports, add at the very top
            content = `${importStatement}\n\n${content}`
          }
          writeFileSync(configPath, content)
        }
      }
    }

    // Use magicast to update the config object
    const mod = await loadFile(configPath)
    const config = getDefaultExportOptions(mod)

    // Add $schema as inline expression
    if (options.schema && !config.safeRuntimeConfig?.$schema) {
      if (!config.safeRuntimeConfig)
        config.safeRuntimeConfig = {}
      ;(config.safeRuntimeConfig as any).$schema = builders.raw(options.schema.schemaExpr)
    }

    // Set shelve config if provided
    if (options.shelve) {
      if (!config.safeRuntimeConfig)
        config.safeRuntimeConfig = {}
      ;(config.safeRuntimeConfig as any).shelve = { project: options.shelve.project, slug: options.shelve.slug }
    }

    await writeFile(mod, configPath)
    return true
  }
  catch (error) {
    logger.error('Failed to update nuxt.config:', error)
    return false
  }
}

interface ShelveAuthResult {
  token: string
  rc: Record<string, string>
}

async function authenticateShelve(url: string, logger: ConsolaInstance): Promise<ShelveAuthResult | null> {
  const rc = readShelveRc()

  // Check for existing token
  if (rc.token) {
    const user = await validateToken(rc.token, url)
    if (user) {
      logger.info(`Logged in as ${user.username}`)
      return { token: rc.token, rc }
    }
  }

  // Prompt for token
  logger.info(`Generate a token at ${url}/user/tokens`)
  const inputToken = await consola.prompt('Enter your Shelve API token:', { type: 'text' })
  if (!inputToken || typeof inputToken !== 'string') {
    logger.warn('No token provided, skipping Shelve setup')
    return null
  }

  const user = await validateToken(inputToken.trim(), url)
  if (!user) {
    logger.error('Invalid token. Please check and try again.')
    return null
  }

  const token = inputToken.trim()
  writeShelveRc({ ...rc, token, email: user.email, username: user.username })
  logger.success('Token saved to ~/.shelve')
  return { token, rc }
}

interface ShelveSelectionResult {
  team: ShelveTeam
  project: ShelveProject
}

async function selectTeamAndProject(token: string, url: string, logger: ConsolaInstance): Promise<ShelveSelectionResult | null> {
  // Select team
  const teams = await fetchTeams(token, url)
  if (!teams.length) {
    logger.error('No teams found. Create a team at Shelve first.')
    return null
  }

  let selectedTeam: ShelveTeam | null = null
  if (teams.length === 1) {
    selectedTeam = teams[0]!
    logger.info(`Using team: ${selectedTeam.name}`)
  }
  else {
    const teamChoice = await consola.prompt('Select team:', {
      type: 'select',
      options: teams.map(t => ({ label: t.name, value: t.slug })),
    })
    if (teamChoice && typeof teamChoice === 'string') {
      selectedTeam = teams.find(t => t.slug === teamChoice) ?? null
    }
  }

  if (!selectedTeam)
    return null

  // Fetch and select project
  const projects = await fetchProjects(token, url, selectedTeam.slug)
  if (!projects.length) {
    logger.warn(`No projects in team "${selectedTeam.name}". Create one at Shelve first.`)
    return null
  }

  let selectedProject: ShelveProject | null = null
  if (projects.length === 1) {
    selectedProject = projects[0]!
    logger.info(`Using project: ${selectedProject.name}`)
  }
  else {
    const projectChoice = await consola.prompt('Select project:', {
      type: 'select',
      options: projects.map(p => ({ label: p.name, value: p.name })),
    })
    if (projectChoice && typeof projectChoice === 'string') {
      selectedProject = projects.find(p => p.name === projectChoice) ?? null
    }
  }

  if (!selectedProject)
    return null

  return { team: selectedTeam, project: selectedProject }
}

export async function runShelveWizard(nuxt: Nuxt): Promise<void> {
  const logger = consola.withTag('shelve-setup')

  // Check if already configured
  const existingConfig = (nuxt.options as any).safeRuntimeConfig
  if (existingConfig?.shelve && typeof existingConfig.shelve === 'object' && (existingConfig.shelve.project || existingConfig.shelve.slug)) {
    return // Already configured
  }

  // 1. Detect or ask for validation library
  let library: ValidationLibrary | null = detectValidationLibrary(nuxt.options.rootDir)
  let needsInstall = false
  if (library) {
    logger.info(`Detected ${library} for schema validation`)
  }
  else {
    const choice = await consola.prompt('Which validation library?', {
      type: 'select',
      options: [
        { label: 'Valibot (recommended)', value: 'valibot' },
        { label: 'Zod', value: 'zod' },
        { label: 'Other / Skip schema generation', value: 'skip' },
      ],
    })
    if (!choice || typeof choice !== 'string' || choice === 'skip') {
      library = null
    }
    else {
      library = choice as ValidationLibrary
      needsInstall = true
    }
  }

  // 2. Ask about Shelve integration
  const enableShelve = await consola.prompt('Enable Shelve secrets integration?', { type: 'confirm', initial: false })

  let variables: ShelveVariable[] = []
  let shelveConfig: { project: string, slug: string } | null = null

  if (enableShelve) {
    const url = process.env.SHELVE_URL || DEFAULT_URL
    const auth = await authenticateShelve(url, logger)

    if (auth) {
      const selection = await selectTeamAndProject(auth.token, url, logger)

      if (selection) {
        shelveConfig = { project: selection.project.name, slug: selection.team.slug }

        // Fetch variables for schema generation
        try {
          const env = await fetchEnvironment(auth.token, url, selection.team.slug, 'development')
          variables = await fetchVariables(auth.token, url, selection.team.slug, selection.project.id, env.id)
          if (variables.length === 0) {
            logger.warn('No variables found in Shelve project, generating placeholder schema')
          }
          else {
            logger.info(`Found ${variables.length} variable(s) in Shelve`)
          }
        }
        catch (error) {
          logger.warn(`Could not fetch variables: ${getErrorMessage(error)}`)
        }
      }
    }
  }

  // 3. Install validation library if needed
  if (library && needsInstall) {
    await installValidationLibrary(nuxt.options.rootDir, library, logger)
  }

  // 4. Generate schema (only if library selected)
  let schemaCode: { imports: string, schemaExpr: string } | null = null
  if (library) {
    const keys = variables.length > 0 ? variables.map(v => v.key) : null
    schemaCode = generateSchemaCode(keys, library)
  }

  // 5. Only update config if we have something to add
  if (!schemaCode && !shelveConfig) {
    logger.info('No configuration changes needed')
    return
  }

  const updated = await updateNuxtConfig(nuxt.options.rootDir, { schema: schemaCode, shelve: shelveConfig, logger })

  if (updated) {
    logger.success('Updated nuxt.config.ts')
    const parts: string[] = []
    if (schemaCode)
      parts.push('schema validation')
    if (shelveConfig)
      parts.push('Shelve integration')
    logger.info(`Added: ${parts.join(' + ')}`)
  }
}
