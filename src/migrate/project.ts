import type { Node } from './ast'
import type { FileEdit, Note, Report } from './report'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import semver from 'semver'
import { applyRemovals, Editor, keyName, lineEnd, lineStart, parentMap, parseJsonc, parseModule, removeStatement, walk } from './ast'
import { catalogName, findUp, Workspace } from './catalog'
import { isModuleName } from './config'

export const moduleName = 'nuxt-safe-runtime-config'
export const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const skippedDirs = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', '.data', 'coverage', '.vercel', '.netlify', '.wrangler', '.turbo', '.cache', '.nitro'])
const codeExtensions = /\.(?:[cm]?[jt]s|[jt]sx|vue)$/
const textExtensions = /\.(?:md|mdx|json|jsonc|json5|ya?ml|toml|txt)$/
const lockfiles = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'npm-shrinkwrap.json'])
const eslintConfig = /^eslint\.config\.[cm]?[jt]s$/

/**
 * Project files relative to `rootDir`, without dependencies, build output and nested packages other than layers.
 * Symbolic links are skipped, so the codemod never edits a file outside the app through one.
 */
export function listFiles(rootDir: string): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    }
    catch {
      return
    }
    for (const entry of entries.sort()) {
      const path = join(dir, entry)
      let stats
      try {
        stats = lstatSync(path)
      }
      catch {
        continue
      }
      if (stats.isDirectory()) {
        if (skippedDirs.has(entry))
          continue
        const rel = relative(rootDir, path)
        if (existsSync(join(path, 'package.json')) && !rel.startsWith('layers'))
          continue
        visit(path)
      }
      else if (stats.isFile()) {
        files.push(relative(rootDir, path).replaceAll('\\', '/'))
      }
    }
  }
  visit(rootDir)
  return files
}

export function isCodeFile(path: string): boolean {
  return codeExtensions.test(path) && !path.endsWith('.d.ts')
}

// Versions

export interface FoundVersion {
  /** The installed version, or the range from package.json or its catalog. */
  text: string
  /** The installed version, or the lowest version the range allows. Undefined when the range isn't semver. */
  version?: string
  installed: boolean
}

/** The lowest version a range allows, such as 4.6.0 for `^4.6` and 0.0.0 for `<4.7.0`. */
export function minimumVersion(range: string | undefined): string | undefined {
  if (!range)
    return undefined
  try {
    return semver.minVersion(range)?.version
  }
  catch {
    return undefined
  }
}

export function meetsMinimum(found: FoundVersion | undefined, minimum: string): boolean {
  return !!found?.version && semver.gte(found.version, minimum)
}

function installedVersion(rootDir: string, name: string): string | undefined {
  const path = findUp(rootDir, join('node_modules', name, 'package.json'))
  if (!path)
    return undefined
  try {
    return semver.valid(JSON.parse(readFileSync(path, 'utf8')).version) ?? undefined
  }
  catch {
    return undefined
  }
}

function declaredRange(rootDir: string, pkg: Record<string, any>, name: string, workspace = new Workspace(rootDir)): string | undefined {
  const range = dependencySections.map(section => pkg[section]?.[name]).find(value => typeof value === 'string') as string | undefined
  const catalog = range === undefined ? undefined : catalogName(range)
  if (catalog !== undefined)
    return workspace.find(catalog, name)?.value ?? range
  return range
}

/** The installed version of a dependency, or else the lowest version its range allows, resolving pnpm catalogs. */
export function dependencyVersion(rootDir: string, pkg: Record<string, any>, name: string): FoundVersion | undefined {
  const installed = installedVersion(rootDir, name)
  if (installed)
    return { text: installed, version: installed, installed: true }
  const range = declaredRange(rootDir, pkg, name)
  if (!range)
    return undefined
  return { text: range, version: minimumVersion(range), installed: false }
}

/** Like dependencyVersion, but the declared range comes first: a fresh install may resolve its lowest version, whatever node_modules holds now. */
function declaredVersion(rootDir: string, pkg: Record<string, any>, name: string, workspace: Workspace): FoundVersion | undefined {
  const range = declaredRange(rootDir, pkg, name, workspace)
  const version = minimumVersion(range)
  if (range && version)
    return { text: range, version, installed: false }
  const installed = installedVersion(rootDir, name)
  if (installed)
    return { text: installed, version: installed, installed: true }
  return range ? { text: range, installed: false } : undefined
}

export function installCommand(rootDir: string): string {
  if (findUp(rootDir, 'pnpm-lock.yaml') || findUp(rootDir, 'pnpm-workspace.yaml'))
    return 'pnpm install'
  if (findUp(rootDir, 'yarn.lock'))
    return 'yarn install'
  if (findUp(rootDir, 'bun.lock') || findUp(rootDir, 'bun.lockb'))
    return 'bun install'
  return 'npm install'
}

// package.json

const converter = '@valibot/to-json-schema'

/** The @valibot/to-json-schema release lines with toStandardJsonSchema(), and the lowest Valibot each one's peer range accepts. */
const converterLines = [
  { minor: 5, valibot: '1.2.0' },
  { minor: 6, valibot: '1.3.0' },
  { minor: 7, valibot: '1.4.0' },
  { minor: 8, valibot: '1.5.0' },
]

/** The newest converter line that accepts `valibot`, and the ranges of the converter that install only compatible releases. */
function converterFor(valibot: string): { wanted: string, accepted: string } {
  const index = converterLines.findLastIndex(line => semver.gte(valibot, line.valibot))
  const line = converterLines[index]!
  const next = converterLines[index + 1]
  return { wanted: `~1.${line.minor}.0`, accepted: next ? `>=1.5.0 <1.${next.minor}.0` : '>=1.5.0' }
}

function fitsRange(range: string, accepted: string): boolean {
  try {
    return !!semver.validRange(range) && semver.subset(range, accepted)
  }
  catch {
    return false
  }
}

function catalogLabel(catalog: string): string {
  return catalog ? `the ${catalog} catalog` : 'the default catalog'
}

/** Edits package.json, and the pnpm catalogs it points at, to drop the module and add the Valibot converter. */
export function migratePackageJson(rootDir: string, valibot: boolean, report: Report): FileEdit[] {
  const path = join(rootDir, 'package.json')
  const before = readFileSync(path, 'utf8')
  const pkg = JSON.parse(before) as Record<string, any>
  const indent = /^([ \t]+)"/m.exec(before)?.[1] ?? '  '
  const workspace = new Workspace(rootDir)
  const catalogSpecifiers: string[] = []
  for (const section of dependencySections) {
    const specifier = pkg[section]?.[moduleName]
    if (typeof specifier !== 'string')
      continue
    delete pkg[section][moduleName]
    if (specifier.startsWith('catalog:'))
      catalogSpecifiers.push(specifier)
  }
  if (valibot)
    addConverter(rootDir, pkg, report, workspace)
  for (const specifier of catalogSpecifiers) {
    const entry = workspace.find(catalogName(specifier)!, moduleName)
    report.manual.push({
      file: entry ? relative(rootDir, entry.file) : 'pnpm-workspace.yaml',
      line: entry?.line,
      text: `the ${specifier} entry for ${moduleName} stays in the catalog. Remove it if no other package uses it`,
    })
  }
  const after = `${JSON.stringify(pkg, null, indent)}${before.endsWith('\n') ? '\n' : ''}`
  const edits: FileEdit[] = []
  if (after !== before)
    edits.push({ path: 'package.json', before, after })
  const workspaceEdit = workspace.edit(rootDir)
  if (workspaceEdit)
    edits.push(workspaceEdit)
  return edits
}

/**
 * Adds a @valibot/to-json-schema range that installs next to the app's Valibot, bumping Valibot below 1.2.
 * When Valibot comes from a pnpm catalog, both versions go in that catalog.
 */
function addConverter(rootDir: string, pkg: Record<string, any>, report: Report, workspace: Workspace): void {
  const found = declaredVersion(rootDir, pkg, 'valibot', workspace)
  const valibotSection = dependencySections.find(name => typeof pkg[name]?.valibot === 'string')
  const specifier = valibotSection ? pkg[valibotSection].valibot as string : undefined
  const catalog = specifier === undefined ? undefined : catalogName(specifier)
  const workspaceFile = workspace.file ? relative(rootDir, workspace.file) : 'pnpm-workspace.yaml'
  if (!found?.version) {
    report.stops.push({ file: 'package.json', text: found ? `valibot ${found.text} is not a version range the codemod can read, so it can't pick a ${converter} release that installs with it` : `the schema uses Valibot, but valibot is not in package.json or node_modules` })
    return
  }
  /** Sets `name` in Valibot's catalog, or stops when that catalog can't be edited. */
  const setInCatalog = (name: string, value: string): boolean => {
    if (workspace.set(catalog!, name, value))
      return true
    report.stops.push({ file: workspaceFile, text: `the codemod can't edit ${catalogLabel(catalog!)}, which valibot comes from. Set ${name} to ${value} there and run the command again` })
    return false
  }
  let valibot = found.version
  let catalogBump: Note | undefined
  if (semver.lt(valibot, '1.2.0')) {
    const because = `the oldest release ${converter} supports with toStandardJsonSchema()`
    if (!valibotSection || !specifier) {
      report.stops.push({ file: 'package.json', text: `valibot ${found.text} is older than 1.2, ${because}. Upgrade valibot to ^1.2.0 and run the command again` })
      return
    }
    if (catalog !== undefined) {
      if (!setInCatalog('valibot', '^1.2.0'))
        return
      catalogBump = { file: workspaceFile, text: `valibot ${found.text} in ${catalogLabel(catalog)} becomes ^1.2.0, ${because}` }
      report.changes.push(catalogBump)
    }
    else {
      pkg[valibotSection].valibot = '^1.2.0'
      report.changes.push({ file: 'package.json', text: `valibot ${specifier} becomes ^1.2.0, ${because}` })
    }
    valibot = '1.2.0'
  }
  const { wanted, accepted } = converterFor(valibot)
  const section = dependencySections.find(name => typeof pkg[name]?.[converter] === 'string') ?? valibotSection ?? 'dependencies'
  const existing = pkg[section]?.[converter] as string | undefined
  const existingCatalog = existing === undefined ? undefined : catalogName(existing)
  if (existing === undefined && catalog !== undefined) {
    const entry = workspace.find(catalog, converter)
    if ((!entry || !fitsRange(entry.value, accepted)) && !setInCatalog(converter, wanted))
      return
    pkg[section] = insertSorted(pkg[section] ?? {}, converter, specifier!)
  }
  else if (existing === undefined) {
    pkg[section] = insertSorted(pkg[section] ?? {}, converter, wanted)
  }
  else if (existingCatalog !== undefined) {
    const entry = workspace.find(existingCatalog, converter)
    if (!entry || !fitsRange(entry.value, accepted)) {
      if (!workspace.set(existingCatalog, converter, wanted))
        report.stops.push({ file: workspaceFile, line: entry?.line, text: `${converter} ${entry?.value ?? existing} does not install a release with toStandardJsonSchema() that accepts valibot ${valibot}, and the codemod can't edit ${catalogLabel(existingCatalog)}. Set it to ${wanted} and run the command again` })
    }
  }
  else if (!fitsRange(existing, accepted)) {
    pkg[section][converter] = wanted
  }
  // Read the line once the converter entry is in, since it may land above Valibot.
  if (catalogBump)
    catalogBump.line = workspace.find(catalog!, 'valibot')?.line
}

function insertSorted(record: Record<string, string>, key: string, value: string): Record<string, string> {
  const keys = Object.keys(record)
  const sorted = keys.every((name, index) => index === 0 || keys[index - 1]!.localeCompare(name) <= 0)
  const entries = [...Object.entries(record), [key, value] as [string, string]]
  if (sorted)
    entries.sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
}

// .nuxtrc and tsconfig

export function migrateNuxtrc(rootDir: string): FileEdit | undefined {
  const path = join(rootDir, '.nuxtrc')
  if (!existsSync(path))
    return undefined
  const before = readFileSync(path, 'utf8')
  const lines = before.split('\n')
  const kept = lines.filter(text => !/^\s*setups\.nuxt-safe-runtime-config\s*=/.test(text))
  if (kept.length === lines.length)
    return undefined
  const after = kept.join('\n')
  return { path: '.nuxtrc', before, after: after.trim() ? after : null }
}

export function migrateTsconfig(rootDir: string, path: string): FileEdit | undefined {
  const before = readFileSync(join(rootDir, path), 'utf8')
  if (!before.includes('safe-runtime-config.d.ts'))
    return undefined
  let root: Node
  try {
    root = parseJsonc(before)
  }
  catch {
    return undefined
  }
  const marked = new Set<Node>()
  walk(root, (node, parent) => {
    if (node.type === 'StringLiteral' && /safe-runtime-config\.d\.ts$/.test(node.value) && parent?.type === 'ArrayExpression')
      marked.add(node)
  })
  if (!marked.size)
    return undefined
  const editor = new Editor(before)
  applyRemovals(editor, root, marked, container => container === root)
  return { path, before, after: editor.toString() }
}

// Source files

const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g

interface DisableDirective {
  /** `//`, `/*` or `<!--`. */
  opener: string
  /** `eslint-disable-next-line ` and the whitespace around it. */
  directive: string
  /** The comma-separated rule list. */
  rules: string
  /** Whitespace after the rules, the `-- reason` and the closing `*\/` or `-->`. */
  rest: string
}

/** Splits an `eslint-disable` comment into its parts, or returns undefined for any other comment. */
function disableDirective(comment: string): DisableDirective | undefined {
  const opener = ['//', '/*', '<!--'].find(prefix => comment.startsWith(prefix))!
  const closer = opener === '/*' ? '*/' : opener === '<!--' ? '-->' : ''
  const body = comment.slice(opener.length, comment.length - closer.length)
  const directive = /^\s*eslint-disable(?:-next-line|-line)?\s/.exec(body)?.[0]
  if (!directive)
    return undefined
  const afterDirective = body.slice(directive.length)
  const reason = afterDirective.search(/\s--\s/)
  const list = reason < 0 ? afterDirective : afterDirective.slice(0, reason)
  const rules = list.trimEnd()
  const leading = rules.length - rules.trimStart().length
  return {
    opener,
    directive: directive + rules.slice(0, leading),
    rules: rules.trimStart(),
    rest: `${list.slice(rules.length)}${reason < 0 ? '' : afterDirective.slice(reason)}${closer}`,
  }
}

/** Removes `safe-runtime-config/*` rules from `eslint-disable` comments, and comments left without rules. */
export function removeDisableComments(code: string): string {
  if (!code.includes('safe-runtime-config/'))
    return code
  const editor = new Editor(code)
  for (const match of code.matchAll(commentPattern)) {
    const comment = match[0]
    const from = match.index!
    const to = from + comment.length
    const parts = disableDirective(comment)
    if (!parts || !parts.rules.includes('safe-runtime-config/'))
      continue
    const rules = parts.rules.split(',').map(rule => rule.trim()).filter(Boolean)
    const kept = rules.filter(rule => !rule.startsWith('safe-runtime-config/'))
    if (kept.length) {
      editor.replace(from, to, `${parts.opener}${parts.directive}${kept.join(', ')}${parts.rest}`)
      continue
    }
    const startOfLine = lineStart(code, from)
    const endOfLine = lineEnd(code, to)
    const ownLine = !code.slice(startOfLine, from).trim() && !code.slice(to, endOfLine).trim()
    if (ownLine)
      editor.remove(startOfLine, endOfLine)
    else
      editor.remove(from - (/[ \t]*$/.exec(code.slice(startOfLine, from))?.[0].length ?? 0), to)
  }
  return editor.toString()
}

// ESLint config

export function isEslintConfig(path: string): boolean {
  return eslintConfig.test(path.split('/').at(-1)!) && !path.includes('/')
}

/** Removes the module's ESLint plugin import, the configs that come from it, and its rule by name. */
export function migrateEslintConfig(path: string, before: string, report: Report): string | undefined {
  if (!before.includes('safe-runtime-config'))
    return before
  let program
  try {
    program = parseModule(before, path)
  }
  catch {
    report.stops.push({ file: path, text: `can't be parsed, so the codemod can't remove the ${moduleName} ESLint plugin` })
    return undefined
  }
  const editor = new Editor(before)
  const bindings = new Set<string>()
  const imports = program.program.body.filter(statement => statement.type === 'ImportDeclaration' && isModuleName(statement.source.value))
  for (const statement of imports) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) bindings.add(specifier.local.name)
    }
  }
  const parents = parentMap(program)
  const marked = new Set<Node>()
  let failed = false
  walk(program, (node, parent, key) => {
    if (parent?.type === 'ImportDeclaration' || parent?.type === 'ImportSpecifier' || parent?.type === 'ImportDefaultSpecifier' || parent?.type === 'ImportNamespaceSpecifier')
      return
    if (node.type === 'Identifier' && bindings.has(node.name) && !((parent?.type === 'MemberExpression' && key === 'property') || (parent?.type === 'ObjectProperty' && key === 'key'))) {
      let current: Node = node
      let entry = parents.get(current)
      while (entry && ((entry.parent.type === 'MemberExpression' && entry.key === 'object') || (entry.parent.type === 'CallExpression' && entry.key === 'callee') || entry.parent.type === 'SpreadElement')) {
        current = entry.parent
        entry = parents.get(current)
      }
      if (entry && (entry.parent.type === 'ArrayExpression' || (entry.parent.type === 'CallExpression' && entry.key === 'arguments'))) {
        marked.add(current)
      }
      else {
        failed = true
        report.stops.push({ file: path, line: node.loc!.start.line, text: `uses the ${moduleName} ESLint plugin in a way the codemod can't remove` })
      }
    }
    if (node.type === 'ObjectProperty' && keyName(node)?.startsWith('safe-runtime-config/'))
      marked.add(node)
  })
  if (failed)
    return undefined
  for (const statement of imports) removeStatement(editor, statement)
  applyRemovals(editor, program, marked)
  return removeDisableComments(editor.toString())
}

// Leftovers

const mentionPattern = /safe-runtime-config|[sS]afeRuntimeConfig/

export function findMentions(files: string[], read: (path: string) => string | undefined, skip: (path: string) => boolean): Note[] {
  const notes: Note[] = []
  for (const path of files) {
    const name = path.split('/').at(-1)!
    if (skip(path) || lockfiles.has(name))
      continue
    if (!isCodeFile(path) && !textExtensions.test(name) && !name.startsWith('.'))
      continue
    const text = read(path)
    if (text === undefined || !mentionPattern.test(text))
      continue
    for (const [index, lineText] of text.split('\n').entries()) {
      if (mentionPattern.test(lineText))
        notes.push({ file: path, line: index + 1, text: `still mentions ${/useSafeRuntimeConfig/.test(lineText) ? 'useSafeRuntimeConfig' : moduleName}. Update it by hand` })
    }
  }
  return notes
}
