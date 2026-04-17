import type { Nuxt } from '@nuxt/schema'
import type { ConsolaInstance } from 'consola'
import type { ShelveProject, ShelveTeam, ShelveUser, ShelveVariable } from '../runtime/shelve-client'
import { exec } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { consola } from 'consola'
import { builders, loadFile, writeFile } from 'magicast'
import { getDefaultExportOptions } from 'magicast/helpers'
import { createShelveClient, DEFAULT_URL } from '../runtime/shelve-client'
import { buildConfigStructureFromEnvKeys } from '../runtime/utils/transform'
import { errorMessage } from '../utils/error'

const execAsync = promisify(exec)

const SHELVE_RC_PATH = join(homedir(), '.shelve')

type ValidationLibrary = 'valibot' | 'zod'

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
    return null
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
  const packages = library === 'valibot' ? ['valibot', '@valibot/to-json-schema'] : ['zod']
  const cmd = pm === 'npm' ? `npm install ${packages.join(' ')}` : `${pm} add ${packages.join(' ')}`

  logger.info(`Installing ${packages.join(', ')}...`)
  try {
    await execAsync(cmd, { cwd: rootDir })
    logger.success(`Installed ${library} dependencies`)
  }
  catch (error) {
    logger.error(`Failed to install dependencies: ${error}`)
  }
}

function generateSchemaCode(keys: string[] | null, library: ValidationLibrary): { imports: string, schemaExpr: string } {
  const s = library === 'valibot' ? 'v.string()' : 'z.string()'
  const o = library === 'valibot' ? 'v.object' : 'z.object'
  const imports = library === 'valibot' ? `import * as v from 'valibot'` : `import { z } from 'zod'`

  if (!keys || keys.length === 0)
    return { imports, schemaExpr: `${o}({})` }

  const structure = buildConfigStructureFromEnvKeys(keys)

  function renderObject(obj: Record<string, true | Record<string, true>>, indent = 2): string {
    const entries = Object.entries(obj)
    if (entries.length === 0)
      return '{}'
    const pad = ' '.repeat(indent)
    const closePad = ' '.repeat(indent - 2)
    const lines = entries.map(([k, v]) => {
      if (v === true)
        return `${pad}${k}: ${s},`
      const nestedKeys = Object.keys(v)
      if (nestedKeys.length <= 2)
        return `${pad}${k}: ${o}({ ${nestedKeys.map(nk => `${nk}: ${s}`).join(', ')} }),`
      const nestedPad = ' '.repeat(indent + 2)
      const nestedLines = nestedKeys.map(nk => `${nestedPad}${nk}: ${s},`)
      return `${pad}${k}: ${o}({\n${nestedLines.join('\n')}\n${pad}}),`
    })
    return `{\n${lines.join('\n')}\n${closePad}}`
  }

  return { imports, schemaExpr: `${o}(${renderObject(structure)})` }
}

function findNuxtConfig(rootDir: string): string | null {
  for (const name of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mts', 'nuxt.config.mjs']) {
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
    if (options.schema) {
      let content = readFileSync(configPath, 'utf-8')
      if (content.includes('$schema')) {
        logger.info('Schema already exists in nuxt.config, skipping schema generation')
      }
      else {
        const importStatement = options.schema.imports
        if (!content.includes(importStatement)) {
          const importMatch = content.match(/^(import[\s\S]*?(?:\n(?!import)|\n$))/m)
          if (importMatch) {
            const lastImportEnd = importMatch.index! + importMatch[0].length
            content = `${content.slice(0, lastImportEnd)}${importStatement}\n${content.slice(lastImportEnd)}`
          }
          else {
            content = `${importStatement}\n\n${content}`
          }
          writeFileSync(configPath, content)
        }
      }
    }

    const mod = await loadFile(configPath)
    const config = getDefaultExportOptions(mod)

    if (options.schema && !config.safeRuntimeConfig?.$schema) {
      if (!config.safeRuntimeConfig)
        config.safeRuntimeConfig = {}
      ;(config.safeRuntimeConfig as any).$schema = builders.raw(options.schema.schemaExpr)
    }

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
  user: ShelveUser
  shouldPersistToken: boolean
  nextRc: Record<string, string>
}

async function authenticateShelve(url: string, logger: ConsolaInstance): Promise<ShelveAuthResult | null> {
  const rc = readShelveRc()

  if (rc.token) {
    const user = await createShelveClient({ token: rc.token, url }).getMe().catch(() => null)
    if (user) {
      logger.info(`Logged in as ${user.username}`)
      return { token: rc.token, user, shouldPersistToken: false, nextRc: rc }
    }
  }

  logger.info(`Generate a token at ${url}/user/tokens`)
  const inputToken = await consola.prompt('Enter your Shelve API token:', { type: 'text' })
  if (!inputToken || typeof inputToken !== 'string') {
    logger.warn('No token provided, skipping Shelve setup')
    return null
  }

  const token = inputToken.trim()
  const user = await createShelveClient({ token, url }).getMe().catch(() => null)
  if (!user) {
    logger.error('Invalid token. Please check and try again.')
    return null
  }

  return {
    token,
    user,
    shouldPersistToken: true,
    nextRc: { ...rc, token, email: user.email, username: user.username },
  }
}

async function selectTeamAndProject(token: string, url: string, logger: ConsolaInstance): Promise<{ team: ShelveTeam, project: ShelveProject } | null> {
  const client = createShelveClient({ token, url })

  const teams = await client.getTeams().catch(() => [] as ShelveTeam[])
  if (!teams.length) {
    logger.error('No teams found. Create a team at Shelve first.')
    return null
  }

  let team: ShelveTeam | null = null
  if (teams.length === 1) {
    team = teams[0]!
    logger.info(`Using team: ${team.name}`)
  }
  else {
    const choice = await consola.prompt('Select team:', {
      type: 'select',
      options: teams.map(t => ({ label: t.name, value: t.slug })),
    })
    if (typeof choice === 'string')
      team = teams.find(t => t.slug === choice) ?? null
  }
  if (!team)
    return null

  const projects = await client.getProjects(team.slug)
  if (!projects.length) {
    logger.warn(`No projects in team "${team.name}". Create one at Shelve first.`)
    return null
  }

  let project: ShelveProject | null = null
  if (projects.length === 1) {
    project = projects[0]!
    logger.info(`Using project: ${project.name}`)
  }
  else {
    const choice = await consola.prompt('Select project:', {
      type: 'select',
      options: projects.map(p => ({ label: p.name, value: p.name })),
    })
    if (typeof choice === 'string')
      project = projects.find(p => p.name === choice) ?? null
  }
  if (!project)
    return null

  return { team, project }
}

interface WizardPlan {
  installLibrary: ValidationLibrary | null
  persistToken: ShelveAuthResult | null
  updateNuxtConfig: boolean
}

function summarizePlannedActions(plan: WizardPlan): string[] {
  const actions: string[] = []
  if (plan.installLibrary) {
    const packages = plan.installLibrary === 'valibot' ? 'valibot, @valibot/to-json-schema' : 'zod'
    actions.push(`Install dependencies: ${packages}`)
  }
  if (plan.persistToken?.shouldPersistToken)
    actions.push(`Write Shelve auth token to ${SHELVE_RC_PATH}`)
  if (plan.updateNuxtConfig)
    actions.push('Update nuxt.config with safeRuntimeConfig setup')
  return actions
}

export async function runShelveWizard(nuxt: Nuxt): Promise<void> {
  const logger = consola.withTag('shelve-setup')

  const existingConfig = (nuxt.options as any).safeRuntimeConfig
  if (existingConfig?.shelve && typeof existingConfig.shelve === 'object' && (existingConfig.shelve.project || existingConfig.shelve.slug))
    return

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

  const enableShelve = await consola.prompt('Enable Shelve secrets integration?', { type: 'confirm', initial: false })

  let variables: ShelveVariable[] = []
  let shelveConfig: { project: string, slug: string } | null = null
  let authResult: ShelveAuthResult | null = null

  if (enableShelve) {
    const url = process.env.SHELVE_URL || DEFAULT_URL
    authResult = await authenticateShelve(url, logger)

    if (authResult) {
      const selection = await selectTeamAndProject(authResult.token, url, logger)
      if (selection) {
        shelveConfig = { project: selection.project.name, slug: selection.team.slug }
        const client = createShelveClient({ token: authResult.token, url })
        try {
          const env = await client.getEnvironment(selection.team.slug, 'development')
          variables = await client.getVariables(selection.team.slug, selection.project.id, env.id)
          if (variables.length === 0)
            logger.warn('No variables found in Shelve project, generating placeholder schema')
          else
            logger.info(`Found ${variables.length} variable(s) in Shelve`)
        }
        catch (error) {
          logger.warn(`Could not fetch variables: ${errorMessage(error)}`)
        }
      }
    }
  }

  let schemaCode: { imports: string, schemaExpr: string } | null = null
  if (library) {
    const keys = variables.length > 0 ? variables.map(v => v.key) : null
    schemaCode = generateSchemaCode(keys, library)
  }

  const wizardPlan: WizardPlan = {
    installLibrary: library && needsInstall ? library : null,
    persistToken: authResult,
    updateNuxtConfig: Boolean(schemaCode || shelveConfig),
  }
  const actions = summarizePlannedActions(wizardPlan)
  if (actions.length === 0) {
    logger.info('No configuration changes needed')
    return
  }

  logger.info('Planned changes:')
  for (const action of actions)
    logger.info(`  - ${action}`)

  const applyChanges = await consola.prompt('Apply these changes?', { type: 'confirm', initial: true })
  if (!applyChanges) {
    logger.info('Setup cancelled. No changes were made.')
    return
  }

  if (wizardPlan.persistToken?.shouldPersistToken) {
    writeShelveRc(wizardPlan.persistToken.nextRc)
    logger.success(`Token saved to ${SHELVE_RC_PATH}`)
    logger.info(`Logged in as ${wizardPlan.persistToken.user.username}`)
  }

  if (wizardPlan.installLibrary)
    await installValidationLibrary(nuxt.options.rootDir, wizardPlan.installLibrary, logger)

  if (!wizardPlan.updateNuxtConfig)
    return

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
