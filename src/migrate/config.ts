import type { File, Node, ObjectExpression, ObjectProperty, Statement } from './ast'
import type { FileEdit, Note, Report } from './report'
import type { SchemaAnalysis } from './schema'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { parseEnv } from 'node:util'
import { createJiti } from 'jiti'
import { snakeCase } from 'scule'
import { applyRemovals, configRoot, detectStyle, Editor, end, findProperty, freeNames, importText, indentOf, insertImport, isEmptyString, keyName, line, parseModule, reindent, removeUnused, resolveObject, start, unwrap, walk } from './ast'
import { analyseSchema, typeMismatches } from './schema'

export const configFileNames = ['nuxt.config.ts', 'nuxt.config.mts', 'nuxt.config.js', 'nuxt.config.mjs']
export const layerConfigPath = 'layers/runtime-config/nuxt.config.ts'
const moduleName = 'nuxt-safe-runtime-config'
const scopes = ['root', '$development', '$production', '$test'] as const
type Scope = typeof scopes[number]
type Loose = Record<string, any>

interface SchemaInfo {
  property: ObjectProperty
  analysis: SchemaAnalysis
  /** Source text of the schema expression, or the import name for a schema file. */
  text: string
  indent: string
  /** Absolute path of a schema file given as a string. */
  importPath?: string
}

interface ScopeInfo {
  scope: Scope
  object?: ObjectExpression
  evaluated?: Loose
  safe?: { property: ObjectProperty, options: ObjectExpression }
  schema?: SchemaInfo
  runtime?: { property: ObjectProperty, object?: ObjectExpression, literal: boolean }
  drops: ObjectProperty[]
  /** Paths of the dropped placeholders. */
  dropPaths: Set<string>
  plain: boolean
}

export interface ConfigResult {
  edits: FileEdit[]
  /** The migrated schemas include Valibot, so the app needs `@valibot/to-json-schema`. */
  valibot: boolean
  /** Writes the refinement report lines once the edits are final. */
  finish: (read: (path: string) => string | undefined) => void
}

export function isModuleName(value: unknown): boolean {
  return typeof value === 'string' && (value === moduleName || value.startsWith(`${moduleName}/`))
}

export function findConfigFile(rootDir: string): string | undefined {
  return configFileNames.map(name => join(rootDir, name)).find(file => existsSync(file))
}

/** Sets the variables of the app's `.env` that are not set yet, as Nuxt does before it loads nuxt.config, and returns a function that undoes it. */
function applyDotenv(rootDir: string): () => void {
  const file = join(rootDir, '.env')
  if (!existsSync(file))
    return () => {}
  const added: string[] = []
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[name] !== undefined || value === undefined)
      continue
    process.env[name] = value
    added.push(name)
  }
  return () => {
    for (const name of added) delete process.env[name]
  }
}

export async function loadNuxtConfig(file: string): Promise<Loose> {
  const jiti = createJiti(file, { interopDefault: false, moduleCache: false, fsCache: false })
  const scope = globalThis as Loose
  const previous = scope.defineNuxtConfig
  scope.defineNuxtConfig = (config: unknown) => config
  const restoreEnv = applyDotenv(dirname(file))
  try {
    const module = await jiti.import<Loose>(file)
    let config = module.default ?? module
    if (typeof config === 'function')
      config = await config()
    return config ?? {}
  }
  finally {
    restoreEnv()
    if (previous === undefined)
      delete scope.defineNuxtConfig
    else
      scope.defineNuxtConfig = previous
  }
}

async function loadSchemaFile(rootDir: string, path: string): Promise<{ file: string, schema: unknown }> {
  // jiti's default interop also unwraps a `default` property, and Zod schemas have a `default()` method.
  const jiti = createJiti(join(rootDir, 'nuxt-safe-runtime-config.loader.mjs'), { interopDefault: false, moduleCache: false, fsCache: false })
  const file = jiti.esmResolve(path)
  const resolved = file.startsWith('file://') ? new URL(file).pathname : file
  const restoreEnv = applyDotenv(rootDir)
  try {
    const module = await jiti.import<{ default?: unknown }>(resolved)
    return { file: resolved, schema: module.default }
  }
  finally {
    restoreEnv()
  }
}

function scopeLabel(scope: Scope): string {
  return scope === 'root' ? '' : `${scope}.`
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key
}

function getPath(value: unknown, path: string): unknown {
  let current = value
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null)
      return undefined
    current = (current as Loose)[key]
  }
  return current
}

function isPlainObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merges `over` onto `base` the way Nuxt merges an environment's runtimeConfig over the root one. */
function mergeValues(base: Loose, over: unknown): Loose {
  if (!isPlainObject(over))
    return base
  const result: Loose = { ...base }
  for (const [key, value] of Object.entries(over))
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeValues(result[key], value) : value
  return result
}

/** The NUXT_* variable that sets a runtimeConfig path when the server starts. */
function envName(path: string): string {
  return `NUXT_${path.split('.').map(part => snakeCase(part).toUpperCase()).join('_')}`
}

function relativeImport(fromDir: string, file: string): string {
  const path = relative(fromDir, file).replaceAll('\\', '/')
  return path.startsWith('.') ? path : `./${path}`
}

export async function migrateConfig(rootDir: string, configFile: string, report: Report): Promise<ConfigResult | undefined> {
  const rel = relative(rootDir, configFile)
  const code = readFileSync(configFile, 'utf8')
  const at = (node: Node | undefined, text: string): Note => ({ file: rel, line: node ? line(node) : undefined, text })
  const stop = (node: Node | undefined, text: string): number => report.stops.push(at(node, text))

  let program: File
  try {
    program = parseModule(code, configFile)
  }
  catch (error) {
    stop(undefined, `nuxt.config can't be parsed: ${(error as Error).message}`)
    return
  }
  const root = configRoot(program)
  if (!root) {
    stop(undefined, 'nuxt.config does not export an object literal, so the codemod can\'t edit it')
    return
  }
  let evaluated: Loose
  try {
    evaluated = await loadNuxtConfig(configFile)
  }
  catch (error) {
    stop(undefined, `nuxt.config can't be loaded: ${(error as Error).message}`)
    return
  }
  const style = detectStyle(code)

  for (const [name, envConfig] of Object.entries((evaluated.$env ?? {}) as Loose)) {
    if (envConfig?.safeRuntimeConfig !== undefined) {
      const holder = resolveObject(program, findProperty(root, '$env')?.value ?? root)
      stop(holder && findProperty(holder, name), `$env.${name}.safeRuntimeConfig sets a schema for one environment name. Nuxt runtimeConfig schemas inside $env are untested, so move it by hand`)
    }
  }

  const marked = new Set<Node>()
  const keep = new Set<Node>([root])
  const infos: ScopeInfo[] = []
  const tupleOptions: Array<{ node: ObjectExpression, evaluated: Loose }> = []

  for (const scope of scopes) {
    const holder = scope === 'root' ? undefined : findProperty(root, scope)
    const object = scope === 'root' ? root : holder && resolveObject(program, holder.value)
    const scopeEvaluated = (scope === 'root' ? evaluated : evaluated[scope]) as Loose | undefined
    const info: ScopeInfo = { scope, object, evaluated: scopeEvaluated, drops: [], dropPaths: new Set(), plain: false }
    infos.push(info)
    if (scopeEvaluated === undefined)
      continue
    if (!object) {
      if (scopeEvaluated.safeRuntimeConfig !== undefined || (scopeEvaluated.modules ?? []).some?.((entry: unknown) => isModuleName(Array.isArray(entry) ? entry[0] : entry)))
        stop(holder ?? root, `${scope} is not an object literal, so the codemod can't edit it`)
      continue
    }
    const spread = spreadSetting(object, scope === 'root' ? ['runtimeConfig', 'safeRuntimeConfig', ...scopes, '$env'] : ['runtimeConfig', 'safeRuntimeConfig'])
    if (spread) {
      stop(spread, `${scope === 'root' ? 'nuxt.config' : scope} has a spread that may set runtimeConfig or safeRuntimeConfig, so the codemod can't tell which values the schema would replace. Write them out and run the command again`)
      continue
    }

    // Module entries.
    const modules = scopeEvaluated.modules
    if (Array.isArray(modules) && modules.some(entry => isModuleName(Array.isArray(entry) ? entry[0] : entry))) {
      const property = findProperty(object, 'modules')
      const array = property && unwrap(property.value)
      const elements = array?.type === 'ArrayExpression'
        ? array.elements.filter((element): element is NonNullable<typeof element> => {
            if (!element)
              return false
            const value = unwrap(element)
            if (value.type === 'StringLiteral')
              return isModuleName(value.value)
            return value.type === 'ArrayExpression' && !!value.elements[0] && value.elements[0].type === 'StringLiteral' && isModuleName(value.elements[0].value)
          })
        : []
      if (!array || array.type !== 'ArrayExpression' || !elements.length) {
        stop(property ?? object, `${scopeLabel(scope)}modules adds ${moduleName} in a way the codemod can't edit, such as a spread or a variable`)
      }
      else {
        keep.add(array)
        for (const element of elements) {
          marked.add(element)
          const value = unwrap(element)
          const options = value.type === 'ArrayExpression' && value.elements[1] ? resolveObject(program, value.elements[1]) : undefined
          const evaluatedTuple = modules.find(entry => Array.isArray(entry) && isModuleName(entry[0]))
          if (options && evaluatedTuple)
            tupleOptions.push({ node: options, evaluated: evaluatedTuple[1] ?? {} })
          else if (value.type === 'ArrayExpression' && value.elements[1])
            stop(value, `the ${moduleName} options in modules are not an object literal, so the codemod can't read them`)
        }
      }
    }

    // safeRuntimeConfig.
    const safeEvaluated = scopeEvaluated.safeRuntimeConfig as Loose | undefined
    const safeProperty = findProperty(object, 'safeRuntimeConfig')
    if (safeEvaluated !== undefined || safeProperty) {
      const options = safeProperty && resolveObject(program, safeProperty.value)
      if (!safeProperty || !options) {
        stop(safeProperty ?? holder ?? root, `${scopeLabel(scope)}safeRuntimeConfig is not an object literal in nuxt.config, so the codemod can't move it`)
        continue
      }
      info.safe = { property: safeProperty, options }
      if (!literalOptions(options, `${scopeLabel(scope)}safeRuntimeConfig`))
        continue
      reportOptions(options, safeEvaluated ?? {}, scope)
      const schemaProperty = findProperty(options, '$schema')
      const schemaValue = safeEvaluated?.$schema
      if (schemaProperty && schemaValue === undefined) {
        stop(schemaProperty, `${scopeLabel(scope)}safeRuntimeConfig.$schema is undefined when nuxt.config loads, so the codemod can't read the schema. Set the variables it depends on (the codemod reads .env like Nuxt does) and run the command again`)
      }
      else if (schemaProperty) {
        let schema = schemaValue
        let importPath: string | undefined
        if (typeof schemaValue === 'string') {
          try {
            const loaded = await loadSchemaFile(rootDir, schemaValue)
            schema = loaded.schema
            importPath = loaded.file
          }
          catch (error) {
            stop(schemaProperty, `the $schema file ${schemaValue} can't be loaded: ${(error as Error).message}`)
            continue
          }
        }
        const analysis = await analyseSchema(schema)
        for (const issue of analysis.stops)
          stop(schemaProperty, `${scopeLabel(scope)}$schema${issue.path ? ` at ${issue.path}` : ''}: ${issue.note}`)
        info.schema = {
          property: schemaProperty,
          analysis,
          text: code.slice(start(schemaProperty.value), end(schemaProperty.value)),
          indent: indentOf(code, start(schemaProperty)),
          importPath,
        }
      }
    }
  }

  for (const tuple of tupleOptions) {
    if (!literalOptions(tuple.node, `the ${moduleName} options in modules`))
      continue
    if (tuple.evaluated.$schema !== undefined || tuple.evaluated.envSchema !== undefined)
      stop(tuple.node, `the ${moduleName} options in modules set $schema or envSchema. Move them to safeRuntimeConfig and run the command again`)
    else
      reportOptions(tuple.node, tuple.evaluated, 'root')
  }

  /** The first spread in `object` that may set one of `keys`, following identifiers to top-level object literals. */
  function spreadSetting(object: ObjectExpression, keys: readonly string[], depth = 0): Node | undefined {
    for (const property of object.properties) {
      if (property.type !== 'SpreadElement')
        continue
      const branches = [unwrap(property.argument)]
      while (branches.some(branch => branch.type === 'ConditionalExpression' || branch.type === 'LogicalExpression')) {
        const branch = branches.findIndex(item => item.type === 'ConditionalExpression' || item.type === 'LogicalExpression')
        const node = branches[branch]!
        branches.splice(branch, 1, ...(node.type === 'ConditionalExpression' ? [node.consequent, node.alternate] : node.type === 'LogicalExpression' ? [node.left, node.right] : []).map(unwrap))
      }
      for (const branch of branches) {
        if (branch.type === 'BooleanLiteral' || branch.type === 'NullLiteral' || (branch.type === 'Identifier' && branch.name === 'undefined'))
          continue
        const resolved = resolveObject(program, branch)
        if (!resolved || depth > 4)
          return property
        if (resolved.properties.some(item => item.type !== 'SpreadElement' && keys.includes(keyName(item) ?? '')) || resolved.properties.some(item => item.type !== 'SpreadElement' && keyName(item) === undefined))
          return property
        if (spreadSetting(resolved, keys, depth + 1))
          return property
      }
    }
    return undefined
  }

  /** Stops on option objects whose keys the codemod can't list: spreads, computed keys and repeated keys. */
  function literalOptions(options: ObjectExpression, label: string): boolean {
    const names = new Set<string>()
    for (const property of options.properties) {
      const name = property.type === 'SpreadElement' ? undefined : keyName(property)
      if (name === undefined) {
        stop(property, `${label} has a spread or a computed key, so the codemod can't tell which options it sets. Write the options out and run the command again`)
        return false
      }
      if (names.has(name)) {
        stop(property, `${label} sets ${name} twice. Keep one and run the command again`)
        return false
      }
      names.add(name)
    }
    return true
  }

  function reportOptions(options: ObjectExpression, values: Loose, scope: Scope): void {
    const label = scopeLabel(scope)
    for (const property of options.properties) {
      if (property.type !== 'ObjectProperty')
        continue
      const name = keyName(property)
      const value = name ? values[name] : undefined
      if (name === 'envSchema')
        stop(property, `${label}envSchema validates against an env-spec file. Nuxt runtimeConfig schemas have no equivalent: move each variable to a schema by hand, then remove the module`)
      else if (name === 'onError' && (value === 'warn' || value === 'ignore'))
        report.changes.push(at(property, `onError: '${value}' is gone. Nuxt stops the server on an invalid value (NUXT_E8014) and has no warn mode`))
      else if (name === 'validateAtRuntime' && value === false)
        report.changes.push(at(property, 'validateAtRuntime: false is gone. Nuxt always checks runtimeConfig when the server starts'))
      else if (name === 'requireAtBuild' && value === true)
        report.changes.push(at(property, 'requireAtBuild: true is gone. Nuxt only warns about a missing value at build (NUXT_B5032), so the build no longer fails'))
      else if (name === 'validateAtBuild')
        report.changes.push(at(property, `validateAtBuild: ${String(value)} is gone. Nuxt checks runtimeConfig during the build, and a missing value only warns (NUXT_B5032)`))
      else if (name === 'jsonSchemaTarget')
        report.changes.push(at(property, 'jsonSchemaTarget is gone. Nuxt always converts the schema to JSON Schema draft-2020-12'))
    }
  }

  if (report.stops.length)
    return

  const schemaScopes = infos.filter(info => info.schema)
  const hasSafe = infos.some(info => info.safe)
  if (!hasSafe && !marked.size)
    return { edits: [], valibot: false, finish: () => {} }

  // Other layers: Nuxt merges their runtimeConfig under this app's, and a schema replaces the plain values below it.
  for (const layer of layerConfigs(rootDir, evaluated.extends)) {
    if (!layer.file) {
      report.manual.push({ file: rel, text: `extends ${layer.source}. If that layer sets runtimeConfig, the schema now replaces those values: add them to the schema` })
      continue
    }
    const layerCode = readFileSync(layer.file, 'utf8')
    const layerRel = relative(rootDir, layer.file)
    if (/safeRuntimeConfig|nuxt-safe-runtime-config/.test(layerCode))
      report.stops.push({ file: layerRel, text: `registers ${moduleName} or sets safeRuntimeConfig in a layer. Migrate the layer by hand first, then run the command again` })
    else if (/\bruntimeConfig\b/.test(layerCode))
      report.stops.push({ file: layerRel, text: 'sets runtimeConfig in a layer, and the schema replaces the plain values of lower layers. Merge them into the schema by hand' })
  }
  if (report.stops.length)
    return

  // Placeholders: drop literal '' for keys a schema requires without a default. A root placeholder applies to every
  // environment, so it goes only when the schema of each environment requires it.
  const required = new Set(schemaScopes.flatMap(info => [...info.schema!.analysis.required]))
  const schemaFor = (scope: Scope): SchemaInfo | undefined => infos.find(info => info.scope === scope)?.schema ?? infos.find(info => info.scope === 'root')?.schema
  const requiredIn = (scope: Scope): ReadonlySet<string> => schemaFor(scope)?.analysis.required ?? new Set()
  const environments = ['$development', '$production', '$test'] as const
  let anyPlain = false
  let allLiteral = true
  for (const info of infos) {
    const property = info.object && findProperty(info.object, 'runtimeConfig')
    if (!property)
      continue
    const value = unwrap(property.value)
    const object = resolveObject(program, property.value)
    info.runtime = { property, object, literal: value.type === 'ObjectExpression' }
    if (!info.runtime.literal)
      allLiteral = false
    if (!object) {
      info.plain = true
      continue
    }
    info.plain = scanRuntimeConfig(object, '', info)
    anyPlain ||= info.plain
  }
  for (const envConfig of Object.values((evaluated.$env ?? {}) as Loose)) {
    if (envConfig?.runtimeConfig && Object.keys(envConfig.runtimeConfig).length)
      anyPlain = true
  }

  function scanRuntimeConfig(object: ObjectExpression, prefix: string, info: ScopeInfo): boolean {
    const scope = info.scope
    let plain = false
    const hasSpread = object.properties.some(property => property.type === 'SpreadElement')
    for (const property of object.properties) {
      const key = property.type === 'ObjectProperty' ? keyName(property) : undefined
      if (property.type !== 'ObjectProperty' || key === undefined) {
        plain = true
        continue
      }
      const path = joinPath(prefix, key)
      const value = unwrap(property.value)
      if (value.type === 'ObjectExpression') {
        plain = scanRuntimeConfig(value, path, info) || plain
        continue
      }
      if (isEmptyString(value)) {
        const requiring = scope === 'root' ? environments.filter(env => requiredIn(env).has(path)) : requiredIn(scope).has(path) ? [scope] : []
        if (scope === 'root' && requiring.length && requiring.length < environments.length) {
          stop(property, `runtimeConfig.${path} is '' and only the ${requiring.join(' and ')} schema requires it. Dropping it leaves the key out of the other environments, and keeping it makes it optional in ${requiring.join(' and ')}. Move it by hand`)
          plain = true
          continue
        }
        if (requiring.length && hasSpread) {
          stop(property, `${scopeLabel(scope)}runtimeConfig.${path} is a placeholder next to a spread, which may set it again. Move it by hand`)
          plain = true
          continue
        }
        if (requiring.length) {
          info.drops.push(property)
          info.dropPaths.add(path)
          continue
        }
      }
      plain = true
    }
    return plain
  }

  // Required keys whose value is '' but not a literal: Nuxt takes '' as the default.
  for (const info of infos) {
    const runtime = info.evaluated?.runtimeConfig
    if (!runtime || !info.runtime)
      continue
    const dropped = new Set(info.drops)
    for (const path of required) {
      if (getPath(runtime, path) !== '')
        continue
      const property = findPathProperty(info.runtime.object, path)
      if (property && dropped.has(property))
        continue
      report.changes.push(at(property ?? info.runtime.property, `${scopeLabel(info.scope)}runtimeConfig.${path} is required by the schema, but its value is '' when nuxt.config loads. Nuxt takes '' as the default, so the value is no longer required`))
    }
  }

  function findPathProperty(object: ObjectExpression | undefined, path: string): ObjectProperty | undefined {
    let current = object
    let property: ObjectProperty | undefined
    for (const key of path.split('.')) {
      property = current && findProperty(current, key)
      if (!property)
        return undefined
      current = resolveObject(program, property.value)
    }
    return property
  }

  const direct = !anyPlain && allLiteral
  if (!direct)
    checkPlainValues()

  /**
   * The schema moves to a layer and the plain values stay as defaults. Reports required keys that have no value
   * when nuxt.config loads, and values whose type the JSON Schema rejects, though the library schema may accept them.
   */
  function checkPlainValues(): void {
    const rootInfo = infos.find(info => info.scope === 'root')!
    for (const info of schemaScopes) {
      const layers = info.scope === 'root' ? [rootInfo] : [rootInfo, info]
      const values = layers.reduce<Loose>((merged, layer) => mergeValues(merged, layer.evaluated?.runtimeConfig), {})
      const dropped = new Set(layers.flatMap(layer => [...layer.dropPaths]))
      const valueAt = (path: string): unknown => dropped.has(path) ? undefined : getPath(values, path)
      const where = (path: string): Note => {
        const property = [...layers].reverse().map(layer => findPathProperty(layer.runtime?.object, path)).find(Boolean)
        return at(property ?? info.runtime?.property ?? rootInfo.runtime?.property, '')
      }
      const label = `${scopeLabel(info.scope)}runtimeConfig`
      const { required, json } = info.schema!.analysis
      const notes: Note[] = []
      for (const path of [...required].sort()) {
        const parts = path.split('.')
        // A missing parent is reported once, or makes the key optional when the parent is.
        if (dropped.has(path) || parts.slice(0, -1).some((_, index) => valueAt(parts.slice(0, index + 1).join('.')) === undefined))
          continue
        if (valueAt(path) === undefined)
          notes.push({ ...where(path), text: `${label}.${path} has no value when nuxt.config loads, and the schema requires it. Unless it has one at build, the server won't start without ${envName(path)} (NUXT_E8014)` })
      }
      for (const mismatch of json ? typeMismatches(json, structuredValues(values, dropped)) : []) {
        notes.push({ ...where(mismatch.path), text: `${label}.${mismatch.path} is ${mismatch.actual} when nuxt.config loads, but the JSON Schema Nuxt checks expects ${mismatch.expected}. Nuxt warns at build (NUXT_B5032) and the server won't start with it (NUXT_E8014): fix the schema or the value` })
      }
      report.changes.push(...notes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)))
    }
  }

  /** `values` without the dropped placeholders. */
  function structuredValues(values: Loose, dropped: ReadonlySet<string>, prefix = ''): Loose {
    const result: Loose = {}
    for (const [key, value] of Object.entries(values)) {
      const path = joinPath(prefix, key)
      if (dropped.has(path))
        continue
      result[key] = isPlainObject(value) ? structuredValues(value, dropped, path) : value
    }
    return result
  }
  const valibot = schemaScopes.some(info => info.schema!.analysis.vendor === 'valibot')
  const needsWrap = schemaScopes.some(info => info.schema!.analysis.needsWrap)
  const usedIdentifiers = new Set<string>()
  walk(program, (node) => {
    if (node.type === 'Identifier')
      usedIdentifiers.add(node.name)
  })
  const importNames = new Map<string, string>()
  for (const info of schemaScopes) {
    const schema = info.schema!
    if (!schema.importPath)
      continue
    let name = importNames.get(schema.importPath)
    if (!name) {
      name = 'runtimeConfigSchema'
      for (let index = 2; usedIdentifiers.has(name); index++) name = `runtimeConfigSchema${index}`
      usedIdentifiers.add(name)
      importNames.set(schema.importPath, name)
    }
    schema.text = name
    schema.indent = ''
  }
  const quote = (value: string): string => `${style.quote}${value.replaceAll('\\', '\\\\').replaceAll(style.quote, `\\${style.quote}`)}${style.quote}`
  const semi = style.semi ? ';' : ''
  const alreadyWrapped = (program: File): boolean => program.program.body.some(statement => statement.type === 'ImportDeclaration' && statement.specifiers.some(specifier => specifier.local.name === 'toStandardJsonSchema'))
  const schemaText = (schema: SchemaInfo, targetIndent: string): string => {
    const text = reindent(schema.text, schema.indent, targetIndent)
    return schema.analysis.needsWrap ? `toStandardJsonSchema(${text})` : text
  }

  // Root config edits.
  const editor = new Editor(code)
  const candidates = new Set<string>()
  for (const info of infos) {
    if (!info.safe)
      continue
    for (const name of freeNames(info.safe.property.value)) candidates.add(name)
    if (info.safe.options !== unwrap(info.safe.property.value)) {
      for (const name of freeNames(info.safe.options)) candidates.add(name)
    }
    if (direct && info.schema) {
      if (info.runtime) {
        editor.replace(start(info.runtime.property.value), end(info.runtime.property.value), schemaText(info.schema, indentOf(code, start(info.runtime.property))))
        marked.add(info.safe.property)
      }
      else {
        editor.replace(start(info.safe.property), end(info.safe.property), `runtimeConfig: ${schemaText(info.schema, indentOf(code, start(info.safe.property)))}`)
      }
    }
    else {
      marked.add(info.safe.property)
    }
  }
  for (const info of infos) {
    if (direct && info.schema && info.runtime)
      continue
    for (const drop of info.drops) marked.add(drop)
  }
  markTypeIncludes(root, marked)
  if (direct) {
    if (needsWrap && !alreadyWrapped(program))
      insertImport(editor, program, `import { toStandardJsonSchema } from ${quote('@valibot/to-json-schema')}${semi}`)
    for (const [path, name] of importNames)
      insertImport(editor, program, `import ${name} from ${quote(relativeImport(dirname(configFile), path))}${semi}`)
  }
  applyRemovals(editor, program, marked, container => keep.has(container))
  let after = removeUnused(editor.toString(), configFile, candidates)

  // Safety net: nothing of the module may stay in the config.
  const leftover = leftoverUse(after, configFile)
  if (leftover !== undefined) {
    stop(undefined, `the codemod could not remove every use of ${moduleName} from nuxt.config (line ${leftover}). Migrate it by hand`)
    return
  }

  const edits: FileEdit[] = []
  let layerText: string | undefined
  if (!direct && schemaScopes.length) {
    const layerFile = join(rootDir, layerConfigPath)
    if (existsSync(layerFile)) {
      stop(undefined, `${layerConfigPath} already exists, so the codemod can't create the runtimeConfig schema layer`)
      return
    }
    layerText = buildLayer(layerFile)
    if (layerText === undefined)
      return
    edits.push({ path: layerConfigPath, before: null, after: layerText })
  }
  if (after !== code)
    edits.unshift({ path: rel, before: code, after })
  else
    after = code

  const conditional = configTimeChoice()
  for (const info of conditional)
    report.changes.push(at(info.schema!.property, `${scopeLabel(info.scope)}$schema depends on values read when nuxt.config loads, such as process.env or a ternary. Nuxt converts the schema the build sees once`))

  return {
    edits,
    valibot,
    finish(read) {
      for (const info of schemaScopes) {
        const file = direct ? rel : layerConfigPath
        const text = read(file)
        if (text === undefined)
          continue
        const located = locateSchema(rootDir, file, text, info.scope)
        for (const note of info.schema!.analysis.refinements) {
          report.refinements.push({ file: located.file, line: lookupLine(located, note.path), text: `${scopeLabel(info.scope)}${note.path || '(root)'}: ${note.note}` })
        }
        for (const note of info.schema!.analysis.changes) {
          report.changes.push({ file: located.file, line: lookupLine(located, note.path), text: `${scopeLabel(info.scope)}${note.path || '(root)'}: ${note.note}` })
        }
      }
    },
  }

  function configTimeChoice(): ScopeInfo[] {
    const statements = topLevelDeclarations(program)
    return schemaScopes.filter((info) => {
      if (info.schema!.importPath)
        return false
      const nodes: Node[] = [info.schema!.property.value]
      const seen = new Set<Node>()
      let dynamic = false
      while (nodes.length && !dynamic) {
        const node = nodes.pop()!
        if (seen.has(node))
          continue
        seen.add(node)
        walk(node, (current) => {
          if (current.type === 'ConditionalExpression' || (current.type === 'MemberExpression' && current.object.type === 'Identifier' && current.object.name === 'process'))
            dynamic = true
        })
        for (const name of freeNames(node)) {
          const statement = statements.get(name)
          if (statement && statement.type !== 'ImportDeclaration')
            nodes.push(statement)
        }
      }
      return dynamic
    })
  }

  function buildLayer(layerFile: string): string | undefined {
    const layerDir = dirname(layerFile)
    const statements = topLevelDeclarations(program)
    const neededImports = new Map<Statement, Set<string>>()
    const neededStatements = new Set<Statement>()
    const queue: string[] = []
    for (const info of schemaScopes) {
      if (!info.schema!.importPath)
        queue.push(...freeNames(info.schema!.property.value))
    }
    queue.push('defineNuxtConfig')
    const seen = new Set<string>()
    while (queue.length) {
      const name = queue.pop()!
      if (seen.has(name))
        continue
      seen.add(name)
      const statement = statements.get(name)
      if (!statement)
        continue
      if (statement.type === 'ImportDeclaration') {
        const names = neededImports.get(statement) ?? new Set<string>()
        names.add(name)
        neededImports.set(statement, names)
        continue
      }
      if (!neededStatements.has(statement)) {
        neededStatements.add(statement)
        queue.push(...freeNames(statement))
      }
    }
    // Code that reads its own location would read the layer's folder after the move.
    const moved: Node[] = [...neededStatements, ...schemaScopes.filter(info => !info.schema!.importPath).map(info => info.schema!.property.value)]
    for (const node of moved) {
      let found: Node | undefined
      walk(node, (current) => {
        if (!found && (current.type === 'MetaProperty' || (current.type === 'Identifier' && (current.name === '__dirname' || current.name === '__filename'))))
          found = current
      })
      if (found) {
        stop(found, `the schema code uses ${found.type === 'MetaProperty' ? 'import.meta' : (found as { name: string }).name}, which would point at ${layerConfigPath} once the schema moves there. Move the schema by hand`)
        return undefined
      }
    }

    const imports: string[] = []
    for (const [statement, names] of neededImports) {
      if (statement.type !== 'ImportDeclaration')
        continue
      const specifiers = statement.specifiers.filter(specifier => names.has(specifier.local.name))
      const source = statement.source.value
      const rewritten = source.startsWith('.') ? relativeImport(layerDir, resolve(dirname(configFile), source)) : source
      imports.push(importText(statement, specifiers, quote(rewritten), style.semi))
    }
    const hasWrapImport = [...neededImports.values()].some(names => names.has('toStandardJsonSchema'))
    if (needsWrap && !hasWrapImport)
      imports.push(`import { toStandardJsonSchema } from ${quote('@valibot/to-json-schema')}${semi}`)
    for (const [path, name] of importNames)
      imports.push(`import ${name} from ${quote(relativeImport(layerDir, path))}${semi}`)
    // External packages first, then relative paths, each sorted by source.
    const rank = (text: string): number => importSource(text).startsWith('.') ? 1 : 0
    imports.sort((a, b) => rank(a) - rank(b) || importSource(a).localeCompare(importSource(b)))

    const declarations = [...neededStatements]
      .sort((a, b) => start(a) - start(b))
      .map((statement) => {
        const node = statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement
        return code.slice(start(node), end(statement))
      })

    const indent = style.indent
    const body: string[] = []
    for (const info of schemaScopes) {
      if (info.scope === 'root')
        body.push(`${indent}runtimeConfig: ${schemaText(info.schema!, indent)},`)
      else
        body.push(`${indent}${info.scope}: {\n${indent}${indent}runtimeConfig: ${schemaText(info.schema!, indent + indent)},\n${indent}},`)
    }
    const parts = [
      imports.join('\n'),
      ...declarations,
      `export default defineNuxtConfig({\n${body.join('\n')}\n})${semi}`,
    ].filter(Boolean)
    return `${parts.join('\n\n')}\n`
  }
}

/** The nuxt.config of each layer in `layers/` and of each local `extends` entry; `file` is undefined for remote layers. */
function layerConfigs(rootDir: string, extendsOption: unknown): Array<{ source: string, file?: string }> {
  const layers: Array<{ source: string, file?: string }> = []
  const layersDir = join(rootDir, 'layers')
  let entries: string[] = []
  try {
    entries = readdirSync(layersDir).sort()
  }
  catch {}
  for (const entry of entries) {
    const file = findConfigFile(join(layersDir, entry))
    if (file)
      layers.push({ source: `layers/${entry}`, file })
  }
  const list = Array.isArray(extendsOption) && !(extendsOption.length === 2 && typeof extendsOption[0] === 'string' && typeof extendsOption[1] === 'object' && !Array.isArray(extendsOption[1])) ? extendsOption : [extendsOption]
  for (const item of list) {
    const source = Array.isArray(item) ? item[0] : item
    if (typeof source !== 'string')
      continue
    if (source.startsWith('.') || source.startsWith('/')) {
      const dir = resolve(rootDir, source)
      const file = findConfigFile(dir) ?? (configFileNames.some(name => dir.endsWith(name)) && existsSync(dir) ? dir : undefined)
      if (file && !layers.some(layer => layer.file === file))
        layers.push({ source, file })
    }
    else {
      layers.push({ source })
    }
  }
  return layers
}

function importSource(text: string): string {
  return /from\s+['"]([^'"]+)['"]/.exec(text)?.[1] ?? text
}

function topLevelDeclarations(program: File): Map<string, Statement> {
  const map = new Map<string, Statement>()
  for (const statement of program.program.body) {
    const node = statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) map.set(specifier.local.name, statement)
    }
    else if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        const names = new Set<string>()
        walk(declarator.id, (current, parent, key) => {
          if (current.type === 'Identifier' && !(parent?.type === 'ObjectProperty' && key === 'key') && key !== 'typeAnnotation')
            names.add(current.name)
          if (current.type === 'TSTypeAnnotation' || current.type === 'AssignmentPattern')
            return current.type === 'AssignmentPattern' ? undefined : false
        })
        for (const name of names) map.set(name, statement)
      }
    }
    else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration' || node.type === 'TSEnumDeclaration') && node.id) {
      map.set(node.id.name, statement)
    }
  }
  return map
}

/** Marks `typescript.*.include` entries that point at the module's generated type file. */
function markTypeIncludes(root: ObjectExpression, marked: Set<Node>): void {
  const typescript = findProperty(root, 'typescript')
  if (!typescript)
    return
  walk(typescript.value, (node) => {
    if (node.type !== 'ArrayExpression')
      return
    for (const element of node.elements) {
      if (element?.type === 'StringLiteral' && /safe-runtime-config\.d\.ts$/.test(element.value))
        marked.add(element)
    }
  })
}

function leftoverUse(code: string, fileName: string): number | undefined {
  const program = parseModule(code, fileName)
  let found: number | undefined
  walk(program, (node) => {
    if (found !== undefined)
      return false
    if ((node.type === 'StringLiteral' && isModuleName(node.value)) || (node.type === 'ObjectProperty' && keyName(node) === 'safeRuntimeConfig'))
      found = line(node)
  })
  return found
}

interface LocatedSchema {
  file: string
  lines: Map<string, number>
  fallback?: number
}

function lookupLine(located: LocatedSchema, path: string): number | undefined {
  const parts = path ? path.split('.') : []
  while (parts.length) {
    const found = located.lines.get(parts.join('.'))
    if (found)
      return found
    parts.pop()
  }
  return located.fallback
}

/** Finds the schema of a scope in a migrated config file, following identifiers into imported schema files. */
function locateSchema(rootDir: string, file: string, code: string, scope: Scope): LocatedSchema {
  const program = parseModule(code, file)
  const root = configRoot(program)
  const object = root && (scope === 'root' ? root : resolveObject(program, findProperty(root, scope)?.value ?? root))
  const runtime = object && findProperty(object, 'runtimeConfig')
  if (!runtime)
    return { file, lines: new Map() }
  let expression = unwrap(runtime.value)
  if (expression.type === 'CallExpression' && expression.callee.type === 'Identifier' && expression.callee.name === 'toStandardJsonSchema' && expression.arguments[0])
    expression = unwrap(expression.arguments[0])
  if (expression.type === 'Identifier') {
    const name = expression.name
    for (const statement of program.program.body) {
      if (statement.type !== 'ImportDeclaration' || !statement.source.value.startsWith('.'))
        continue
      const specifier = statement.specifiers.find(specifier => specifier.local.name === name)
      if (!specifier)
        continue
      const target = resolveFile(resolve(rootDir, dirname(file)), statement.source.value)
      if (!target)
        break
      const exported = specifier.type === 'ImportSpecifier' ? (specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value) : 'default'
      return locateExport(rootDir, target, exported)
    }
  }
  const lines = new Map<string, number>()
  schemaLines(program, expression, '', lines, 0)
  return { file, lines, fallback: line(runtime) }
}

function resolveFile(dir: string, source: string): string | undefined {
  const base = resolve(dir, source)
  return [base, `${base}.ts`, `${base}.mts`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts')].find(path => existsSync(path) && !path.endsWith('/'))
}

function locateExport(rootDir: string, target: string, exported: string): LocatedSchema {
  const file = relative(rootDir, target)
  const code = readFileSync(target, 'utf8')
  const program = parseModule(code, target)
  for (const statement of program.program.body) {
    let node: Node | undefined
    if (exported === 'default' && statement.type === 'ExportDefaultDeclaration') {
      node = statement.declaration
    }
    else if (statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration') {
      const declarator = statement.declaration.declarations.find(declarator => declarator.id.type === 'Identifier' && declarator.id.name === exported)
      node = declarator?.init ?? undefined
    }
    if (node) {
      const lines = new Map<string, number>()
      schemaLines(program, node, '', lines, 0)
      return { file, lines, fallback: line(node) }
    }
  }
  return { file, lines: new Map() }
}

function schemaLines(program: File, node: Node, prefix: string, lines: Map<string, number>, depth: number): void {
  if (depth > 6)
    return
  const value = unwrap(node)
  switch (value.type) {
    case 'ObjectExpression':
      for (const property of value.properties) {
        if (property.type !== 'ObjectProperty')
          continue
        const key = keyName(property)
        if (key === undefined)
          continue
        const path = joinPath(prefix, key)
        if (!lines.has(path))
          lines.set(path, line(property))
        schemaLines(program, property.value, path, lines, depth)
      }
      return
    case 'CallExpression':
      schemaLines(program, value.callee, prefix, lines, depth)
      for (const argument of value.arguments) schemaLines(program, argument, prefix, lines, depth)
      return
    case 'MemberExpression':
      schemaLines(program, value.object, prefix, lines, depth)
      return
    case 'ConditionalExpression':
      schemaLines(program, value.consequent, prefix, lines, depth)
      schemaLines(program, value.alternate, prefix, lines, depth)
      return
    case 'ArrayExpression':
      for (const element of value.elements) {
        if (element)
          schemaLines(program, element, prefix, lines, depth)
      }
      return
    case 'Identifier': {
      for (const statement of program.program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
        if (declaration?.type !== 'VariableDeclaration')
          continue
        const declarator = declaration.declarations.find(declarator => declarator.id.type === 'Identifier' && declarator.id.name === value.name)
        if (declarator?.init)
          schemaLines(program, declarator.init, prefix, lines, depth + 1)
      }
    }
  }
}
