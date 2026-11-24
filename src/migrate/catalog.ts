import type { FileEdit } from './report'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** Reads and edits the pnpm catalogs in the pnpm-workspace.yaml above an app, one line at a time. */

export interface CatalogEntry {
  file: string
  line: number
  value: string
}

interface Section {
  /** Index of the `catalog:` or `catalogs.<name>:` line. */
  header: number
  headerIndent: number
  /** Set when the section is written inline, such as `catalog: { vue: ^3.5.0 }`. */
  inline: boolean
  entries: Array<{ key: string, line: number, indent: number, value: string }>
}

/** The catalog a `catalog:` specifier names: `''` for the default catalog. */
export function catalogName(specifier: string): string | undefined {
  if (!specifier.startsWith('catalog:'))
    return undefined
  const name = specifier.slice('catalog:'.length).trim()
  return name === 'default' ? '' : name
}

export function findUp(from: string, name: string): string | undefined {
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

/** Replaces the value of a `key: value` line, keeping its quotes and a trailing comment. */
function replaceValue(text: string, value: string): string | undefined {
  const rest = text.trimStart()
  const quote = rest[0] === '"' || rest[0] === '\'' ? rest[0] : undefined
  const keyEnd = text.length - rest.length + (quote ? rest.indexOf(quote, 1) + 1 : 0)
  const colon = text.indexOf(':', keyEnd)
  if (colon < 0)
    return undefined
  const valueStart = colon + 1 + (text.slice(colon + 1).length - text.slice(colon + 1).trimStart().length)
  const comment = text.slice(valueStart).search(/\s#/)
  const valueEnd = comment < 0 ? text.trimEnd().length : valueStart + comment
  const old = text.slice(valueStart, valueEnd)
  const valueQuote = old.length > 1 && (old[0] === '"' || old[0] === '\'') && old.at(-1) === old[0] ? old[0] : ''
  return `${text.slice(0, valueStart)}${valueQuote}${value}${valueQuote}${text.slice(valueEnd)}`
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

function parseSections(lines: string[]): Map<string, Section> {
  const sections = new Map<string, Section>()
  const stack: Array<{ indent: number, key: string }> = []
  for (const [index, text] of lines.entries()) {
    if (!text.trim() || text.trim().startsWith('#'))
      continue
    const entry = yamlEntry(text)
    if (!entry)
      continue
    const { indent, key, value } = entry
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const path = stack.map(item => item.key)
    const header = path.length === 0 && key === 'catalog' ? '' : path.length === 1 && path[0] === 'catalogs' ? (key === 'default' ? '' : key) : undefined
    if (header !== undefined && !sections.has(header))
      sections.set(header, { header: index, headerIndent: indent, inline: value !== '', entries: [] })
    const member = path.length === 1 && path[0] === 'catalog' ? '' : path.length === 2 && path[0] === 'catalogs' ? (path[1] === 'default' ? '' : path[1]) : undefined
    if (member !== undefined)
      sections.get(member)?.entries.push({ key, line: index, indent, value: unquote(value) })
    stack.push({ indent, key })
  }
  return sections
}

/** The pnpm-workspace.yaml found up from an app, with the edits the codemod makes to its catalogs. */
export class Workspace {
  readonly file: string | undefined
  private readonly before: string | undefined
  private text: string | undefined

  constructor(rootDir: string) {
    this.file = findUp(rootDir, 'pnpm-workspace.yaml')
    this.before = this.file ? readFileSync(this.file, 'utf8') : undefined
    this.text = this.before
  }

  find(catalog: string, name: string): CatalogEntry | undefined {
    if (!this.file || this.text === undefined)
      return undefined
    const entry = parseSections(this.text.split('\n')).get(catalog)?.entries.find(item => item.key === name)
    return entry && { file: this.file, line: entry.line + 1, value: entry.value }
  }

  /** Sets `name` in a catalog that exists, keeping the key's quotes and a trailing comment. Undefined when it can't. */
  set(catalog: string, name: string, value: string): CatalogEntry | undefined {
    if (!this.file || this.text === undefined)
      return undefined
    const lines = this.text.split('\n')
    const section = parseSections(lines).get(catalog)
    if (!section || section.inline)
      return undefined
    const existing = section.entries.find(item => item.key === name)
    let line: number
    if (existing) {
      const replaced = replaceValue(lines[existing.line]!, value)
      if (replaced === undefined)
        return undefined
      lines[existing.line] = replaced
      line = existing.line
    }
    else {
      const indent = ' '.repeat(section.entries[0]?.indent ?? section.headerIndent + 2)
      const quote = /^\s*(['"])@/m.exec(this.text)?.[1] ?? '\''
      const key = /^[\w.-][\w./-]*$/.test(name) ? name : `${quote}${name}${quote}`
      const keys = section.entries.map(item => item.key)
      const sorted = keys.every((item, index) => index === 0 || keys[index - 1]!.localeCompare(item) <= 0)
      const after = sorted ? section.entries.find(item => item.key.localeCompare(name) > 0) : undefined
      line = after ? after.line : (section.entries.at(-1)?.line ?? section.header) + 1
      lines.splice(line, 0, `${indent}${key}: ${value}`)
    }
    this.text = lines.join('\n')
    return { file: this.file, line: line + 1, value }
  }

  /** The edit to pnpm-workspace.yaml, with its path relative to the app. */
  edit(rootDir: string): FileEdit | undefined {
    if (!this.file || this.text === this.before || this.before === undefined || this.text === undefined)
      return undefined
    return { path: relative(rootDir, this.file).replaceAll('\\', '/'), before: this.before, after: this.text }
  }
}
