import type { Comment, Expression, File, Node, ObjectExpression, ObjectProperty, Statement } from '@babel/types'
import { parse, parseExpression } from '@babel/parser'

export type { Expression, File, Node, ObjectExpression, ObjectProperty, Statement }

export function parseModule(code: string, fileName = 'file.ts', errorRecovery = false): File {
  const jsx = /\.[jt]sx$/.test(fileName)
  return parse(code, { sourceType: 'module', errorRecovery, plugins: jsx ? ['typescript', 'jsx'] : ['typescript'] })
}

/** Parses JSON with comments, such as tsconfig.json, keeping offsets. */
export function parseJsonc(code: string): Node {
  return parseExpression(code, { plugins: [] })
}

export function start(node: Node): number {
  return node.start!
}

export function end(node: Node): number {
  return node.end!
}

export function line(node: Node): number {
  return node.loc!.start.line
}

export function lineAt(code: string, offset: number): number {
  let count = 1
  for (let index = 0; index < offset && index < code.length; index++) {
    if (code[index] === '\n')
      count++
  }
  return count
}

const skippedKeys = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'])

/** Calls `visit` on every node below `root`, parents first. Returning `false` skips the children. */
export function walk(root: Node, visit: (node: Node, parent: Node | undefined, key: string) => boolean | void): void {
  const step = (node: Node, parent: Node | undefined, key: string): void => {
    if (visit(node, parent, key) === false)
      return
    for (const [childKey, value] of Object.entries(node)) {
      if (skippedKeys.has(childKey))
        continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item))
            step(item, node, childKey)
        }
      }
      else if (isNode(value)) {
        step(value, node, childKey)
      }
    }
  }
  step(root, undefined, '')
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/** Strips TypeScript wrappers such as `as const`, `satisfies T` and `x!`. */
export function unwrap(node: Node): Node {
  let current = node
  while (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression' || current.type === 'TSNonNullExpression' || current.type === 'ParenthesizedExpression' || current.type === 'TSTypeAssertion')
    current = current.expression
  return current
}

export function keyName(property: { key: Node, computed?: boolean }): string | undefined {
  const key = property.key
  if (key.type === 'Identifier' && !property.computed)
    return key.name
  if (key.type === 'StringLiteral')
    return key.value
  return undefined
}

export function findProperty(object: ObjectExpression, name: string): ObjectProperty | undefined {
  for (const property of object.properties) {
    if (property.type === 'ObjectProperty' && keyName(property) === name)
      return property
  }
}

export function isEmptyString(node: Node): boolean {
  const value = unwrap(node)
  if (value.type === 'StringLiteral')
    return value.value === ''
  return value.type === 'TemplateLiteral' && value.expressions.length === 0 && value.quasis.every(quasi => quasi.value.raw === '')
}

/** The object passed to `defineNuxtConfig()` or exported as default. */
export function configRoot(program: File): ObjectExpression | undefined {
  const bindings = topLevelInits(program)
  const resolve = (node: Node | undefined | null, depth = 0): ObjectExpression | undefined => {
    if (!node || depth > 4)
      return undefined
    const value = unwrap(node)
    if (value.type === 'ObjectExpression')
      return value
    if (value.type === 'CallExpression' && value.callee.type === 'Identifier' && value.callee.name === 'defineNuxtConfig')
      return resolve(value.arguments[0], depth + 1)
    if (value.type === 'Identifier')
      return resolve(bindings.get(value.name), depth + 1)
  }
  for (const statement of program.program.body) {
    if (statement.type === 'ExportDefaultDeclaration')
      return resolve(statement.declaration)
  }
}

function topLevelInits(program: File): Map<string, Node> {
  const inits = new Map<string, Node>()
  for (const statement of program.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration')
      continue
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.init)
        inits.set(declarator.id.name, declarator.init)
    }
  }
  return inits
}

/** Resolves an identifier to the object literal of a top-level `const`. */
export function resolveObject(program: File, node: Node): ObjectExpression | undefined {
  const value = unwrap(node)
  if (value.type === 'ObjectExpression')
    return value
  if (value.type === 'Identifier') {
    const init = topLevelInits(program).get(value.name)
    const resolved = init && unwrap(init)
    return resolved?.type === 'ObjectExpression' ? resolved : undefined
  }
}

export interface TextEdit {
  start: number
  end: number
  text: string
}

export class Editor {
  private edits: TextEdit[] = []

  constructor(readonly code: string) {}

  replace(from: number, to: number, text: string): void {
    this.edits.push({ start: from, end: to, text })
  }

  remove(from: number, to: number): void {
    this.replace(from, to, '')
  }

  insert(at: number, text: string): void {
    this.replace(at, at, text)
  }

  get changed(): boolean {
    return this.edits.length > 0
  }

  toString(): string {
    const sorted = [...this.edits].sort((a, b) => a.start - b.start || a.end - b.end)
    let output = ''
    let cursor = 0
    for (const edit of sorted) {
      if (edit.start < cursor)
        throw new Error(`Overlapping edits at offset ${edit.start}`)
      output += this.code.slice(cursor, edit.start) + edit.text
      cursor = edit.end
    }
    return output + this.code.slice(cursor)
  }
}

export function lineStart(code: string, offset: number): number {
  return code.lastIndexOf('\n', offset - 1) + 1
}

/** Offset after the newline that ends the line containing `offset`, or the end of the code. */
export function lineEnd(code: string, offset: number): number {
  const index = code.indexOf('\n', offset)
  return index === -1 ? code.length : index + 1
}

export function indentOf(code: string, offset: number): string {
  const from = lineStart(code, offset)
  return /^[ \t]*/.exec(code.slice(from))![0]
}

/** Start of `node` including comments on their own lines right above it. */
function startWithComments(code: string, node: Node, floor: number): number {
  let from = start(node)
  const comments: Comment[] = node.leadingComments ?? []
  for (const comment of [...comments].reverse()) {
    if (comment.start! < floor || !/^\s*$/.test(code.slice(lineStart(code, comment.start!), comment.start!)))
      break
    if (!/^\s*$/.test(code.slice(comment.end!, from)))
      break
    from = comment.start!
  }
  return from
}

/** Where the line of the item ends, when only a comma and a line comment follow it there. */
function ownLineEnd(code: string, offset: number): number | undefined {
  const rest = /^[ \t]*(?:,[ \t]*)?(?:\/\/[^\n]*)?(?:\n|$)/.exec(code.slice(offset))
  return rest ? offset + rest[0].length : undefined
}

/**
 * Removes `items[index]` for each index in `remove` from a comma-separated list, such as array
 * elements, object properties or call arguments. `open` and `close` are the offsets just inside
 * the brackets, so a list that loses every item becomes `[]` or `{}`.
 */
export function removeListItems(editor: Editor, items: readonly Node[], remove: ReadonlySet<number>, open: number, close: number): void {
  const code = editor.code
  if (!remove.size)
    return
  if (remove.size === items.length) {
    editor.remove(open, close)
    return
  }
  const runs: Array<[number, number]> = []
  for (let index = 0; index < items.length; index++) {
    if (!remove.has(index))
      continue
    const last = runs.at(-1)
    if (last && last[1] === index - 1)
      last[1] = index
    else
      runs.push([index, index])
  }
  for (const [first, last] of runs) {
    const previous = items[first - 1]
    const next = items[last + 1]
    const floor = previous ? end(previous) : open
    const from = startWithComments(code, items[first]!, floor)
    const to = ownLineEnd(code, end(items[last]!))
    const ownLine = /^[ \t]*$/.test(code.slice(lineStart(code, from), from)) && lineStart(code, from) >= floor && to !== undefined
    if (ownLine) {
      editor.remove(lineStart(code, from), to!)
      // Without a trailing comma style, the new last item must not keep its comma.
      if (!next && previous && !/^[ \t]*,/.test(code.slice(end(items[last]!)))) {
        const comma = code.indexOf(',', end(previous))
        if (comma !== -1 && comma < lineStart(code, from))
          editor.remove(comma, comma + 1)
      }
    }
    else if (next) {
      editor.remove(from, start(next))
    }
    else {
      editor.remove(end(previous!), end(items[last]!))
    }
  }
}

export function removeListItem(editor: Editor, items: readonly Node[], item: Node, open: number, close: number): void {
  removeListItems(editor, items, new Set([items.indexOf(item)]), open, close)
}

/** Removes a whole top-level statement, with its own-line comments, and the line it sat on. */
export function removeStatement(editor: Editor, statement: Node): void {
  const code = editor.code
  const from = startWithComments(code, statement, 0)
  const to = ownLineEnd(code, end(statement))
  if (to !== undefined && /^[ \t]*$/.test(code.slice(lineStart(code, from), from)))
    editor.remove(lineStart(code, from), to)
  else
    editor.remove(from, end(statement))
}

/** Shifts the lines after the first one from the indentation `from` to `to`. */
export function reindent(text: string, from: string, to: string): string {
  if (from === to)
    return text
  return text.split('\n').map((textLine, index) => {
    if (index === 0)
      return textLine
    return textLine.startsWith(from) ? to + textLine.slice(from.length) : textLine
  }).join('\n')
}

export interface CodeStyle {
  quote: '\'' | '"'
  semi: boolean
  indent: string
}

export function detectStyle(code: string): CodeStyle {
  const single = (code.match(/'/g) ?? []).length
  const double = (code.match(/"/g) ?? []).length
  const indent = /^([ \t]+)\S/m.exec(code)?.[1] ?? '  '
  const semi = /^(?:import|export)\b[^\n]*;[ \t]*$/m.test(code) || /\)\s*;\s*$/.test(code.trimEnd())
  return { quote: double > single ? '"' : '\'', semi, indent }
}

export function quote(value: string, style: CodeStyle): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll(style.quote, `\\${style.quote}`)
  return `${style.quote}${escaped}${style.quote}`
}

const bindingParents = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', 'ObjectMethod', 'ClassMethod'])

/**
 * Names that `node` reads from its scope: identifiers outside property keys, member properties and
 * declarations. Names that `node` declares itself, such as arrow function parameters, are left out.
 */
export function freeNames(node: Node): Set<string> {
  const declared = new Set<string>()
  const used = new Set<string>()
  walk(node, (current, parent, key) => {
    if (bindingParents.has(current.type)) {
      const fn = current as Node & { params?: Node[], id?: Node | null }
      for (const param of fn.params ?? []) collectPattern(param, declared)
      if (fn.id && current !== node)
        collectPattern(fn.id, declared)
    }
    if (current.type === 'VariableDeclarator' && current !== node)
      collectPattern(current.id, declared)
    if (current.type === 'CatchClause' && current.param)
      collectPattern(current.param, declared)
    if (current.type !== 'Identifier')
      return
    if (!parent) {
      used.add(current.name)
      return
    }
    if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed)
      return
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty' || parent.type === 'ClassMethod' || parent.type === 'TSPropertySignature' || parent.type === 'TSMethodSignature') && key === 'key' && !(parent as { computed?: boolean }).computed)
      return
    if (parent.type === 'TSQualifiedName' && key === 'right')
      return
    if (key === 'label' || parent.type === 'TSTypeParameter' || (parent.type === 'TSEnumMember' && key === 'id'))
      return
    used.add(current.name)
  })
  for (const name of declared) used.delete(name)
  return used
}

export function collectPattern(pattern: Node, names: Set<string>): void {
  walk(pattern, (current, parent, key) => {
    if (current.type === 'Identifier' && !(parent?.type === 'ObjectProperty' && key === 'key' && !parent.computed && !parent.shorthand))
      names.add(current.name)
    // Default values and type annotations are reads, not declarations.
    if (current.type === 'AssignmentPattern') {
      collectPattern(current.left, names)
      return false
    }
    if (current.type === 'TSTypeAnnotation')
      return false
  })
}

const typeWrappers = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TSTypeAssertion'])

export interface ParentEntry {
  parent: Node
  key: string
}

export function parentMap(root: Node): Map<Node, ParentEntry> {
  const parents = new Map<Node, ParentEntry>()
  walk(root, (node, parent, key) => {
    if (parent)
      parents.set(node, { parent, key })
  })
  return parents
}

function listItems(container: Node): Node[] {
  if (container.type === 'ObjectExpression')
    return container.properties
  if (container.type === 'ArrayExpression')
    return container.elements.filter((element): element is NonNullable<typeof element> => element !== null)
  if (container.type === 'CallExpression' || container.type === 'NewExpression')
    return container.arguments
  return []
}

function listBounds(code: string, container: Node): [number, number] {
  if (container.type === 'CallExpression' || container.type === 'NewExpression') {
    const calleeEnd = end((container as { typeArguments?: Node | null }).typeArguments ?? container.callee)
    return [code.indexOf('(', calleeEnd) + 1, end(container) - 1]
  }
  return [start(container) + 1, end(container) - 1]
}

/**
 * Removes the marked object properties, array elements and call arguments. An object or array that loses
 * every item is removed too when it is the value of a property or an array element, unless `keep` says no.
 */
export function applyRemovals(editor: Editor, root: Node, marked: Iterable<Node>, keep: (container: Node) => boolean = () => false): void {
  const parents = parentMap(root)
  const removed = new Set(marked)
  const containerOf = (node: Node): Node | undefined => parents.get(node)?.parent
  let changed = true
  while (changed) {
    changed = false
    const containers = new Set([...removed].map(containerOf).filter((node): node is Node => !!node))
    for (const container of containers) {
      const items = listItems(container)
      if (!items.length || !items.every(item => removed.has(item)) || keep(container))
        continue
      if (container.type !== 'ObjectExpression' && container.type !== 'ArrayExpression')
        continue
      let holderChild: Node = container
      let entry = parents.get(container)
      while (entry && typeWrappers.has(entry.parent.type)) {
        holderChild = entry.parent
        entry = parents.get(entry.parent)
      }
      if (!entry)
        continue
      const holder = entry.parent.type === 'ObjectProperty' && entry.key === 'value'
        ? entry.parent
        : entry.parent.type === 'ArrayExpression' || (entry.parent.type === 'CallExpression' && entry.key === 'arguments') ? holderChild : undefined
      if (holder && !removed.has(holder)) {
        removed.add(holder)
        changed = true
      }
    }
  }
  const insideRemoved = (node: Node): boolean => {
    let current = parents.get(node)?.parent
    while (current) {
      if (removed.has(current))
        return true
      current = parents.get(current)?.parent
    }
    return false
  }
  const byContainer = new Map<Node, Set<number>>()
  for (const node of removed) {
    if (insideRemoved(node))
      continue
    const container = containerOf(node)
    if (!container)
      continue
    const index = listItems(container).indexOf(node)
    if (index === -1)
      continue
    const set = byContainer.get(container) ?? new Set<number>()
    set.add(index)
    byContainer.set(container, set)
  }
  for (const [container, indexes] of byContainer) {
    const [open, close] = listBounds(editor.code, container)
    removeListItems(editor, listItems(container), indexes, open, close)
  }
}

type ImportDeclaration = Extract<Statement, { type: 'ImportDeclaration' }>
type ImportSpecifierNode = ImportDeclaration['specifiers'][number]

function specifierText(specifier: ImportSpecifierNode): string {
  if (specifier.type === 'ImportDefaultSpecifier')
    return specifier.local.name
  if (specifier.type === 'ImportNamespaceSpecifier')
    return `* as ${specifier.local.name}`
  const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : JSON.stringify(specifier.imported.value)
  const prefix = specifier.importKind === 'type' ? 'type ' : ''
  return imported === specifier.local.name ? `${prefix}${imported}` : `${prefix}${imported} as ${specifier.local.name}`
}

/** Writes an import statement for some specifiers of `declaration`, importing from `source` (already quoted). */
export function importText(declaration: ImportDeclaration, specifiers: readonly ImportSpecifierNode[], source: string, semi: boolean): string {
  const typePrefix = declaration.importKind === 'type' ? 'type ' : ''
  const defaults = specifiers.filter(specifier => specifier.type !== 'ImportSpecifier').map(specifierText)
  const named = specifiers.filter(specifier => specifier.type === 'ImportSpecifier').map(specifierText)
  const parts = [...defaults, ...(named.length ? [`{ ${named.join(', ')} }`] : [])]
  return `import ${typePrefix}${parts.join(', ')} from ${source}${semi ? ';' : ''}`
}

/** Removes some specifiers of an import, or the whole statement when none stay. */
export function removeImportSpecifiers(editor: Editor, declaration: ImportDeclaration, remove: ReadonlySet<ImportSpecifierNode>): void {
  const code = editor.code
  const kept = declaration.specifiers.filter(specifier => !remove.has(specifier))
  if (!remove.size)
    return
  if (!kept.length) {
    removeStatement(editor, declaration)
    return
  }
  const named = declaration.specifiers.filter(specifier => specifier.type === 'ImportSpecifier')
  const keptNamed = kept.filter(specifier => specifier.type === 'ImportSpecifier')
  if (keptNamed.length) {
    const open = code.indexOf('{', start(declaration)) + 1
    const close = code.indexOf('}', open)
    const indexes = new Set(named.flatMap((specifier, index) => remove.has(specifier) ? [index] : []))
    removeListItems(editor, named, indexes, open, close)
    const defaults = declaration.specifiers.filter(specifier => specifier.type !== 'ImportSpecifier')
    if (defaults.some(specifier => remove.has(specifier)))
      editor.remove(start(defaults[0]!), open - 1)
    return
  }
  const source = code.slice(start(declaration.source), end(declaration.source))
  editor.replace(start(declaration), end(declaration), importText(declaration, kept, source, code.slice(start(declaration), end(declaration)).trimEnd().endsWith(';')))
}

/** Names that a top-level statement declares. */
export function declaredNames(statement: Statement): Set<string> {
  const names = new Set<string>()
  const node = statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) collectPattern(declarator.id, names)
  }
  else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration' || node.type === 'TSEnumDeclaration') && node.id) {
    names.add(node.id.name)
  }
  else if (node.type === 'ImportDeclaration') {
    for (const specifier of node.specifiers) names.add(specifier.local.name)
  }
  return names
}

/** Names used by top-level statements other than the one that declares them. */
export function usedNames(program: File): Map<string, number> {
  const counts = new Map<string, number>()
  for (const statement of program.program.body) {
    if (statement.type === 'ImportDeclaration')
      continue
    const own = declaredNames(statement)
    for (const name of freeNames(statement)) {
      if (!own.has(name))
        counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Removes top-level imports and declarations named in `candidates` that nothing else uses, repeating while
 * removals free more names. Exported declarations and side-effect imports stay.
 */
export function removeUnused(code: string, fileName: string, candidates: Iterable<string>): string {
  const pending = new Set(candidates)
  for (let round = 0; round < 20; round++) {
    const program = parseModule(code, fileName)
    const used = usedNames(program)
    const editor = new Editor(code)
    for (const statement of program.program.body) {
      if (statement.type === 'ImportDeclaration') {
        const remove = new Set(statement.specifiers.filter(specifier => pending.has(specifier.local.name) && !used.has(specifier.local.name)))
        removeImportSpecifiers(editor, statement, remove)
        continue
      }
      if (statement.type !== 'VariableDeclaration' && statement.type !== 'FunctionDeclaration' && statement.type !== 'ClassDeclaration' && statement.type !== 'TSTypeAliasDeclaration' && statement.type !== 'TSInterfaceDeclaration')
        continue
      const names = declaredNames(statement)
      if (!names.size || ![...names].every(name => pending.has(name) && !used.has(name)))
        continue
      removeStatement(editor, statement)
      for (const name of freeNames(statement)) pending.add(name)
    }
    if (!editor.changed)
      break
    code = editor.toString()
  }
  return code
}

/**
 * Inserts the import `text` among the top-level imports, before the first one that sorts after it
 * (packages before relative paths, then by source), or at the top.
 */
export function insertImport(editor: Editor, program: File, text: string): void {
  const imports = program.program.body.filter(statement => statement.type === 'ImportDeclaration')
  const source = /from\s+['"]([^'"]+)['"]/.exec(text)?.[1] ?? ''
  const order = (value: string) => [value.startsWith('.') ? 1 : 0, value] as const
  const [rank, name] = order(source)
  const next = imports.find((statement) => {
    const [otherRank, otherName] = order(statement.source.value)
    return otherRank > rank || (otherRank === rank && otherName.localeCompare(name) > 0)
  })
  if (next) {
    const at = lineStart(editor.code, start(next))
    editor.insert(at, `${text}\n`)
    return
  }
  const last = imports.at(-1)
  if (last) {
    editor.insert(end(last), `\n${text}`)
    return
  }
  const first = program.program.body[0]
  const at = first ? startWithComments(editor.code, first, 0) : 0
  editor.insert(lineStart(editor.code, at), `${text}\n\n`)
}

/**
 * Removing statements can leave blank lines at the top of a file or two blank lines in a row.
 * Collapses those, unless the original file already had two blank lines in a row somewhere.
 */
export function tidyBlankLines(before: string, after: string): string {
  let text = after.replace(/^(?:[ \t]*\n)+/, '')
  if (!/\n[ \t]*\n[ \t]*\n/.test(before))
    text = text.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
  return text
}
