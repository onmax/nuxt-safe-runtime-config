import type { Node } from './ast'
import type { FileEdit, Note, Report } from './report'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { applyRemovals, Editor, keyName, lineAt, lineEnd, lineStart, parentMap, parseJsonc, parseModule, removeImportSpecifiers, removeStatement, walk } from './ast'
import { isModuleName } from './config'

export const moduleName = 'nuxt-safe-runtime-config'
export const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const skippedDirs = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', '.data', 'coverage', '.vercel', '.netlify', '.wrangler', '.turbo', '.cache', '.nitro'])
const codeExtensions = /\.(?:[cm]?[jt]s|[jt]sx|vue)$/
const textExtensions = /\.(?:md|mdx|json|jsonc|json5|ya?ml|toml|txt)$/
const lockfiles = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'npm-shrinkwrap.json'])
const eslintConfig = /^eslint\.config\.[cm]?[jt]s$/

/** Project files relative to `rootDir`, without dependencies, build output and nested packages other than layers. */
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
        stats = statSync(path)
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

function findUp(from: string, name: string): string | undefined {
  let dir = from
  while (true) {
    const path = join(dir, name)
    if (existsSync(path))
      return path
    const parent = dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }
}

// Versions

export interface Version {
  major: number
  minor: number
  patch: number
}

export function parseVersion(text: string | undefined): Version | undefined {
  const match = text && /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text)
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) } : undefined
}

export function atLeast(version: Version, major: number, minor: number): boolean {
  return version.major > major || (version.major === major && version.minor >= minor)
}

function installedVersion(rootDir: string, name: string): string | undefined {
  const path = findUp(rootDir, join('node_modules', name, 'package.json'))
  if (!path)
    return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')).version
  }
  catch {
    return undefined
  }
}

/** The installed version of a dependency, or the lowest version its range allows, resolving pnpm catalogs. */
export function dependencyVersion(rootDir: string, pkg: Record<string, any>, name: string): { text: string, version?: Version, installed: boolean } | undefined {
  const installed = installedVersion(rootDir, name)
  if (installed)
    return { text: installed, version: parseVersion(installed), installed: true }
  const range = dependencySections.map(section => pkg[section]?.[name]).find(value => typeof value === 'string') as string | undefined
  if (!range)
    return undefined
  const resolved = range.startsWith('catalog:') ? catalogRange(rootDir, name, range.slice('catalog:'.length)) : range
  return { text: resolved ?? range, version: parseVersion(resolved), installed: false }
}

interface CatalogEntry {
  file: string
  line: number
  value: string
}

/** Reads `key: value` from one line of YAML, with an optionally quoted key and a trailing comment. */
function yamlEntry(text: string): { indent: number, key: string, value: string } | undefined {
  const rest = text.trimStart()
  const indent = text.length - rest.length
  const quote = rest[0] === '"' || rest[0] === '\'' ? rest[0] : undefined
  const keyEnd = quote ? rest.indexOf(quote, 1) : rest.indexOf(':')
  if (keyEnd < 0)
    return undefined
  const key = quote ? rest.slice(1, keyEnd) : rest.slice(0, keyEnd).trim()
  const afterKey = rest.slice(quote ? keyEnd + 1 : keyEnd).trimStart()
  if (!key || key.includes('#') || !afterKey.startsWith(':'))
    return undefined
  let value = afterKey.slice(1)
  const comment = value.search(/\s#/)
  if (comment >= 0)
    value = value.slice(0, comment)
  return { indent, key, value: value.trim() }
}

/** Finds `name` in the default catalog or a named catalog of pnpm-workspace.yaml. */
export function findCatalogEntry(rootDir: string, name: string, catalog: string): CatalogEntry | undefined {
  const file = findUp(rootDir, 'pnpm-workspace.yaml')
  if (!file)
    return undefined
  const lines = readFileSync(file, 'utf8').split('\n')
  const section = catalog && catalog !== 'default' ? ['catalogs', catalog] : ['catalog']
  const stack: Array<{ indent: number, key: string }> = []
  for (const [index, text] of lines.entries()) {
    if (!text.trim() || text.trim().startsWith('#'))
      continue
    const entry = yamlEntry(text)
    if (!entry)
      continue
    const { indent, key } = entry
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const path = stack.map(item => item.key)
    const sectionMatch = (path.length === section.length && path.every((part, position) => part === section[position]))
      || (section[0] === 'catalogs' && section[1] === 'default' && path.length === 1 && path[0] === 'catalog')
    if (sectionMatch && key === name)
      return { file, line: index + 1, value: entry.value.replace(/^['"]|['"]$/g, '') }
    stack.push({ indent, key })
  }
  return undefined
}

function catalogRange(rootDir: string, name: string, catalog: string): string | undefined {
  return findCatalogEntry(rootDir, name, catalog)?.value
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

/** The @valibot/to-json-schema release that matches the app's Valibot, all of them with toStandardJsonSchema(). */
function converterRange(valibot: Version | undefined): string {
  if (!valibot || atLeast(valibot, 1, 5))
    return '^1.8.0'
  if (atLeast(valibot, 1, 4))
    return '^1.7.0'
  if (atLeast(valibot, 1, 3))
    return '^1.6.0'
  return '^1.5.0'
}

export function migratePackageJson(rootDir: string, valibot: boolean, report: Report): FileEdit | undefined {
  const path = join(rootDir, 'package.json')
  const before = readFileSync(path, 'utf8')
  const pkg = JSON.parse(before) as Record<string, any>
  const indent = /^([ \t]+)"/m.exec(before)?.[1] ?? '  '
  for (const section of dependencySections) {
    const specifier = pkg[section]?.[moduleName]
    if (typeof specifier !== 'string')
      continue
    delete pkg[section][moduleName]
    if (specifier.startsWith('catalog:')) {
      const entry = findCatalogEntry(rootDir, moduleName, specifier.slice('catalog:'.length))
      report.manual.push({
        file: entry ? relative(rootDir, entry.file) : 'pnpm-workspace.yaml',
        line: entry?.line,
        text: `the ${specifier} entry for ${moduleName} stays in the catalog. Remove it if no other package uses it`,
      })
    }
  }
  if (valibot) {
    const converter = '@valibot/to-json-schema'
    const valibotVersion = dependencyVersion(rootDir, pkg, 'valibot')?.version
    const wanted = converterRange(valibotVersion)
    if (valibotVersion && !atLeast(valibotVersion, 1, 2))
      report.manual.push({ file: 'package.json', text: `valibot ${valibotVersion.major}.${valibotVersion.minor} is older than 1.2, which ${converter} needs. Upgrade valibot` })
    const section = dependencySections.find(name => pkg[name]?.[converter]) ?? dependencySections.find(name => pkg[name]?.valibot) ?? 'dependencies'
    const existing = pkg[section]?.[converter] as string | undefined
    if (existing === undefined) {
      pkg[section] = insertSorted(pkg[section] ?? {}, converter, wanted)
    }
    else if (existing.startsWith('catalog:')) {
      const entry = findCatalogEntry(rootDir, converter, existing.slice('catalog:'.length))
      const version = parseVersion(entry?.value)
      if (!version || !atLeast(version, 1, 5))
        report.manual.push({ file: entry ? relative(rootDir, entry.file) : 'pnpm-workspace.yaml', line: entry?.line, text: `${converter} needs ${wanted} for toStandardJsonSchema(). Update the catalog entry` })
    }
    else {
      const version = parseVersion(existing)
      if (version && !atLeast(version, 1, 5))
        pkg[section][converter] = wanted
    }
  }
  const after = `${JSON.stringify(pkg, null, indent)}${before.endsWith('\n') ? '\n' : ''}`
  return after === before ? undefined : { path: 'package.json', before, after }
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

const renamePattern = /(?<![\w$])useSafeRuntimeConfig(?![\w$])/g

/** Replaces everything outside `<script>` blocks of a Vue file with spaces, keeping offsets and lines. */
function scriptView(path: string, code: string): string {
  if (!path.endsWith('.vue'))
    return code
  let output = ''
  let cursor = 0
  for (const match of code.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/g)) {
    const contentStart = match.index! + match[1]!.length
    output += code.slice(cursor, contentStart).replace(/[^\n]/g, ' ') + match[2]
    cursor = contentStart + match[2]!.length
  }
  return output + code.slice(cursor).replace(/[^\n]/g, ' ')
}

function parseFileName(path: string, code: string): string {
  if (!path.endsWith('.vue'))
    return path
  return /<script[^>]*\slang=["']tsx["']/.test(code) ? 'file.tsx' : 'file.ts'
}

/** Renames useSafeRuntimeConfig, drops duplicate lines and imports it leaves, and cleans ESLint comments. */
export function migrateSource(path: string, before: string, report: Report): string {
  let code = before
  if (renamePattern.test(code)) {
    renamePattern.lastIndex = 0
    const output: string[] = []
    for (const [index, text] of code.split('\n').entries()) {
      if (!renamePattern.test(text)) {
        output.push(text)
        continue
      }
      renamePattern.lastIndex = 0
      const renamed = text.replace(renamePattern, 'useRuntimeConfig')
      const previous = output.at(-1)
      if (previous !== undefined && previous.trim() && previous.trim() === renamed.trim())
        continue
      if (previous !== undefined && /stubGlobal\(\s*['"`]useRuntimeConfig['"`]/.test(previous) && /stubGlobal\(\s*['"`]useRuntimeConfig['"`]/.test(renamed))
        report.manual.push({ file: path, line: index + 1, text: 'stubs useRuntimeConfig right after another stub of it. Keep one' })
      output.push(renamed)
    }
    code = output.join('\n')
    code = fixImports(path, code, report)
  }
  return removeDisableComments(code)
}

function fixImports(path: string, code: string, report: Report): string {
  const view = scriptView(path, code)
  let program
  try {
    program = parseModule(view, parseFileName(path, code), true)
  }
  catch {
    return code
  }
  const editor = new Editor(code)
  const seen = new Set<string>()
  for (const statement of program.program.body) {
    if (statement.type !== 'ImportDeclaration')
      continue
    const remove = new Set<typeof statement.specifiers[number]>()
    for (const specifier of statement.specifiers) {
      if (seen.has(specifier.local.name))
        remove.add(specifier)
      seen.add(specifier.local.name)
    }
    if (isModuleName(statement.source.value) && statement.source.value !== `${moduleName}/eslint`) {
      const rest = code.slice(0, statement.start!) + code.slice(statement.end!)
      for (const specifier of statement.specifiers) {
        if (remove.has(specifier))
          continue
        if (new RegExp(`(?<![\\w$])${specifier.local.name.replaceAll('$', '\\$')}(?![\\w$])`).test(rest))
          report.manual.push({ file: path, line: lineAt(code, statement.start!), text: `still imports ${specifier.local.name} from ${statement.source.value}. Replace it by hand` })
        else
          remove.add(specifier)
      }
    }
    removeImportSpecifiers(editor, statement, remove)
  }
  return editor.toString()
}

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
