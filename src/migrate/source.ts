import type { File, Node } from './ast'
import type { Report } from './report'
import { collectPattern, Editor, lineAt, lineEnd, lineStart, parseModule, removeImportSpecifiers, unwrap } from './ast'
import { isModuleName } from './config'
import { moduleName, removeDisableComments } from './project'

const oldName = 'useSafeRuntimeConfig'
const newName = 'useRuntimeConfig'
const aliasPrefix = '#safe-runtime-config/'
/** Module imports that only re-export Nuxt's or Nitro's composable, so the auto-import replaces them. */
const replaceableImports: Record<string, string> = {
  [`${aliasPrefix}server`]: oldName,
  [`${aliasPrefix}nitro-runtime-config`]: newName,
}
/** Imports of useRuntimeConfig that are the same function as the auto-import. */
const equivalentSources = new Set(['#imports', '#app', 'nuxt/app', '#app/nuxt', 'nitropack/runtime', 'nitro/runtime', '#internal/nitro'])
const globalObjects = new Set(['globalThis', 'global', 'window', 'self'])
const stubCalls = new Set(['stubGlobal', 'mockNuxtImport'])
/** Nitro factories whose handler gets the request event, and the index of the event parameter. */
const handlerFactories: Record<string, number> = {
  defineEventHandler: 0,
  eventHandler: 0,
  defineCachedEventHandler: 0,
  cachedEventHandler: 0,
  defineNitroErrorHandler: 1,
}
const pluginFactories = new Set(['defineNitroPlugin'])
const skippedKeys = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'])

type ImportSpecifierNode = Extract<Node, { type: 'ImportSpecifier' | 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier' }>
type ImportDeclarationNode = Extract<Node, { type: 'ImportDeclaration' }>
type Binding = 'local' | ImportSpecifierNode

class Scope {
  readonly names = new Map<string, Binding>()
  constructor(readonly parent?: Scope) {}
  lookup(name: string): Binding | undefined {
    return this.names.get(name) ?? this.parent?.lookup(name)
  }

  /** The scope that declares `name`. */
  owner(name: string): Scope | undefined {
    return this.names.has(name) ? this : this.parent?.owner(name)
  }
}

/** What a function is to Nitro: a request handler with its event parameter, a plugin's setup, or neither. */
type FunctionRole = { kind: 'handler', event?: string } | { kind: 'plugin' }

interface FunctionFrame { role?: FunctionRole, scope: Scope }

export interface SourceOptions {
  /**
   * Pass the request event to useRuntimeConfig() in server handlers, as Nitro 2 expects. Off on Nitro 3, whose
   * useRuntimeConfig() takes no event.
   */
  eventArgument?: boolean
}

interface TextEdit { start: number, end: number, text: string }

function isFunction(node: Node): node is Extract<Node, { type: 'FunctionExpression' | 'ArrowFunctionExpression' | 'ObjectMethod' }> {
  return node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod'
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

function children(node: Node): Array<{ child: Node, key: string }> {
  const list: Array<{ child: Node, key: string }> = []
  for (const [key, value] of Object.entries(node)) {
    if (skippedKeys.has(key))
      continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item))
          list.push({ child: item, key })
      }
    }
    else if (isNode(value)) {
      list.push({ child: value, key })
    }
  }
  return list
}

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

function stringValue(node: Node | undefined): string | undefined {
  if (!node)
    return undefined
  if (node.type === 'StringLiteral')
    return node.value
  if (node.type === 'TemplateLiteral' && !node.expressions.length)
    return node.quasis[0]?.value.cooked ?? undefined
  return undefined
}

function importedName(specifier: ImportSpecifierNode): string | undefined {
  if (specifier.type !== 'ImportSpecifier')
    return undefined
  return specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
}

/**
 * Renames useSafeRuntimeConfig to useRuntimeConfig where it refers to the module's composable: free references (the
 * auto-import), imports from `#imports`, and imports from the module's aliases, which it removes. Also renames the
 * name in `vi.stubGlobal()`, `mockNuxtImport()` and `globalThis.*`. Stops on imports of the module that have no Nuxt
 * equivalent, and where a local `useRuntimeConfig` would capture the renamed call. In server files, passes the
 * request event of the enclosing Nitro handler to a call without arguments, and reports the calls that have none.
 */
export function migrateSource(path: string, before: string, report: Report, options: SourceOptions = {}): string {
  const serverFile = options.eventArgument === true && /(?:^|\/)server\//.test(path)
  const view = scriptView(path, before)
  let program: File
  try {
    program = parseModule(view, parseFileName(path, before), true)
  }
  catch (error) {
    if (/useSafeRuntimeConfig|safe-runtime-config\/|nuxt-safe-runtime-config/.test(view))
      report.stops.push({ file: path, text: `can't be parsed (${(error as Error).message}), so the codemod can't rename useSafeRuntimeConfig in it` })
    return before
  }
  const code = before
  const stopAt = (offset: number, text: string): void => {
    report.stops.push({ file: path, line: lineAt(code, offset), text })
  }

  // Imports: which bindings the rename replaces, and which import specifiers go.
  const renamed = new Set<ImportSpecifierNode>()
  const removals = new Map<ImportDeclarationNode, Set<ImportSpecifierNode>>()
  const specifierEdits: TextEdit[] = []
  const importsRuntimeConfig = program.program.body.some(statement => statement.type === 'ImportDeclaration' && statement.source.value === '#imports' && statement.specifiers.some(specifier => specifier.local.name === newName))
  const remove = (declaration: ImportDeclarationNode, specifier: ImportSpecifierNode): void => {
    const set = removals.get(declaration) ?? new Set()
    set.add(specifier)
    removals.set(declaration, set)
  }
  for (const statement of program.program.body) {
    if (statement.type !== 'ImportDeclaration')
      continue
    const source = statement.source.value
    if (source === '#imports') {
      for (const specifier of statement.specifiers) {
        if (importedName(specifier) !== oldName)
          continue
        if (specifier.local.name !== oldName) {
          const imported = (specifier as Extract<Node, { type: 'ImportSpecifier' }>).imported
          specifierEdits.push({ start: imported.start!, end: imported.end!, text: newName })
          continue
        }
        renamed.add(specifier)
        if (importsRuntimeConfig)
          remove(statement, specifier)
        else
          specifierEdits.push({ start: specifier.start!, end: specifier.end!, text: newName })
      }
      continue
    }
    if (source === `${moduleName}/eslint` || !(isModuleName(source) || source.startsWith(aliasPrefix)))
      continue
    for (const specifier of statement.specifiers) {
      const expected = replaceableImports[source]
      if (expected && importedName(specifier) === expected && statement.importKind !== 'type' && specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
        renamed.add(specifier)
        remove(statement, specifier)
      }
      else {
        stopAt(specifier.start!, `imports ${specifier.local.name} from ${source}, which has no Nuxt equivalent. Replace it by hand`)
      }
    }
    if (!statement.specifiers.length)
      stopAt(statement.start!, `imports ${source}, which goes away with the module. Remove it by hand`)
  }

  const edits: TextEdit[] = []
  function renameAt(node: Node, scope: Scope, name: string, replace: () => void): void {
    if (name !== newName) {
      const binding = scope.lookup(newName)
      const safe = binding === undefined
        || (binding !== 'local' && (renamed.has(binding) || removalsHas(binding) || equivalentSources.has(sourceOf(binding))))
      if (!safe) {
        stopAt(node.start!, `calls ${name}, and renaming it to ${newName} would call the local ${newName} declared in this scope. Rename one of them by hand`)
        return
      }
    }
    replace()
  }
  function removalsHas(specifier: ImportSpecifierNode): boolean {
    return [...removals.values()].some(set => set.has(specifier))
  }
  function sourceOf(specifier: ImportSpecifierNode): string {
    for (const statement of program.program.body) {
      if (statement.type === 'ImportDeclaration' && statement.specifiers.includes(specifier as never))
        return statement.source.value
    }
    return ''
  }

  function isTarget(name: string, scope: Scope): boolean {
    const binding = scope.lookup(name)
    if (binding === undefined)
      return name === oldName
    return binding !== 'local' && renamed.has(binding)
  }

  function reference(node: Node & { type: 'Identifier' }, parent: Node | undefined, key: string, scope: Scope): void {
    if (!isTarget(node.name, scope))
      return
    if (parent?.type === 'ExportSpecifier') {
      stopAt(node.start!, `exports ${node.name}. Re-export useRuntimeConfig by hand`)
      return
    }
    if (parent?.type === 'ObjectProperty' && parent.shorthand && key === 'value') {
      renameAt(node, scope, node.name, () => edits.push({ start: parent.start!, end: parent.end!, text: `${node.name}: ${newName}` }))
      return
    }
    if (node.name !== newName)
      renameAt(node, scope, node.name, () => edits.push({ start: node.start!, end: node.end!, text: newName }))
  }

  /** Strings that name the global composable: `vi.stubGlobal('useSafeRuntimeConfig')` and `globalThis.useSafeRuntimeConfig`. */
  function renameString(node: Node): void {
    edits.push({ start: node.start! + 1, end: node.end! - 1, text: newName })
  }

  function declare(scope: Scope, pattern: Node): void {
    const names = new Set<string>()
    collectPattern(pattern, names)
    for (const name of names) scope.names.set(name, 'local')
  }

  /** Declares the bindings a statement list creates in `scope`: `let`, `const`, functions and classes, and `var` too when `hoist`. */
  function hoist(statements: readonly Node[], scope: Scope, vars: boolean): void {
    for (const statement of statements) {
      const node = (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') && statement.declaration ? statement.declaration : statement
      if (node.type === 'VariableDeclaration' && (node.kind !== 'var' || vars)) {
        for (const declarator of node.declarations) declare(scope, declarator.id)
      }
      else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'TSEnumDeclaration' || node.type === 'TSDeclareFunction') && node.id) {
        scope.names.set(node.id.name, 'local')
      }
      else if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) scope.names.set(specifier.local.name, specifier)
      }
    }
    if (!vars)
      return
    const visitVars = (node: Node): void => {
      for (const { child } of children(node)) {
        if (/Function|Method/.test(child.type) || child.type === 'ClassDeclaration' || child.type === 'ClassExpression')
          continue
        if (child.type === 'VariableDeclaration' && child.kind === 'var') {
          for (const declarator of child.declarations) declare(scope, declarator.id)
        }
        visitVars(child)
      }
    }
    for (const statement of statements) visitVars(statement)
  }

  function visitPattern(node: Node, scope: Scope): void {
    switch (node.type) {
      case 'Identifier':
        if (node.typeAnnotation)
          visit(node.typeAnnotation, node, 'typeAnnotation', scope)
        return
      case 'ObjectPattern':
        for (const property of node.properties) {
          if (property.type === 'RestElement') {
            visitPattern(property.argument, scope)
            continue
          }
          if (property.computed)
            visit(property.key, property, 'key', scope)
          visitPattern(property.value, scope)
        }
        if (node.typeAnnotation)
          visit(node.typeAnnotation, node, 'typeAnnotation', scope)
        return
      case 'ArrayPattern':
        for (const element of node.elements) {
          if (element)
            visitPattern(element, scope)
        }
        if (node.typeAnnotation)
          visit(node.typeAnnotation, node, 'typeAnnotation', scope)
        return
      case 'AssignmentPattern':
        visitPattern(node.left, scope)
        visit(node.right, node, 'right', scope)
        return
      case 'RestElement':
        visitPattern(node.argument, scope)
        if (node.typeAnnotation)
          visit(node.typeAnnotation, node, 'typeAnnotation', scope)
        return
      case 'TSParameterProperty':
        visitPattern(node.parameter, scope)
        return
      default:
        visit(node, undefined, '', scope)
    }
  }

  /** Roles of the functions passed to Nitro's handler and plugin factories, and the functions entered so far. */
  const roles = new Map<Node, FunctionRole>()
  const frames: FunctionFrame[] = []

  function markFactoryCall(callee: Node, args: readonly Node[], scope: Scope): void {
    if (!serverFile || callee.type !== 'Identifier' || scope.lookup(callee.name) === 'local')
      return
    const first = args[0] && unwrap(args[0])
    if (!first)
      return
    if (pluginFactories.has(callee.name)) {
      if (isFunction(first))
        roles.set(first, { kind: 'plugin' })
      return
    }
    const index = handlerFactories[callee.name]
    if (index === undefined)
      return
    let handler: Node | undefined = first
    if (first.type === 'ObjectExpression') {
      const property = first.properties.find(item => (item.type === 'ObjectProperty' || item.type === 'ObjectMethod') && !item.computed && item.key.type === 'Identifier' && item.key.name === 'handler')
      handler = property?.type === 'ObjectMethod' ? property : property?.type === 'ObjectProperty' ? unwrap(property.value) : undefined
    }
    if (!handler || !isFunction(handler))
      return
    const param = handler.params[index]
    roles.set(handler, { kind: 'handler', event: param?.type === 'Identifier' ? param.name : undefined })
  }

  /** Passes the request event to a renamed call in a server file, or reports the call when no event is in scope. */
  function eventArgument(node: Extract<Node, { type: 'CallExpression' | 'OptionalCallExpression' }>, scope: Scope): void {
    if (!serverFile || node.arguments.length)
      return
    const callee = unwrap(node.callee)
    if (callee.type !== 'Identifier' || !isTarget(callee.name, scope))
      return
    const current = frames.at(-1)
    // A plugin's setup runs once at startup, outside any request.
    if (current?.role?.kind === 'plugin')
      return
    const handler = [...frames].reverse().find(frame => frame.role?.kind === 'handler')
    const event = handler?.role?.kind === 'handler' ? handler.role.event : undefined
    if (handler && event && scope.owner(event) === handler.scope) {
      const close = code.lastIndexOf(')', node.end! - 1)
      edits.push({ start: close, end: close, text: event })
      return
    }
    report.manual.push({ file: path, line: lineAt(code, node.start!), text: `calls ${newName}() without the request event. Pass the event if the call runs during a request` })
  }

  function visitFunction(node: Node & { params: Node[], body: Node }, scope: Scope): void {
    const inner = new Scope(scope)
    frames.push({ role: roles.get(node), scope: inner })
    try {
      visitFunctionIn(node, inner)
    }
    finally {
      frames.pop()
    }
  }

  function visitFunctionIn(node: Node & { params: Node[], body: Node }, inner: Scope): void {
    if (node.type === 'FunctionExpression' && node.id)
      inner.names.set(node.id.name, 'local')
    for (const param of node.params) declare(inner, param)
    for (const param of node.params) visitPattern(param, inner)
    for (const key of ['typeParameters', 'returnType', 'decorators'] as const) {
      const value = (node as unknown as Record<string, unknown>)[key]
      for (const child of Array.isArray(value) ? value : [value]) {
        if (isNode(child))
          visit(child, node, key, inner)
      }
    }
    if (node.body.type === 'BlockStatement') {
      hoist(node.body.body, inner, true)
      for (const statement of node.body.body) visit(statement, node.body, 'body', inner)
    }
    else {
      visit(node.body, node, 'body', inner)
    }
  }

  function visitChildren(node: Node, scope: Scope, skip: ReadonlySet<string> = new Set()): void {
    for (const { child, key } of children(node)) {
      if (!skip.has(key))
        visit(child, node, key, scope)
    }
  }

  function visit(node: Node, parent: Node | undefined, key: string, scope: Scope): void {
    switch (node.type) {
      case 'ImportDeclaration':
        return
      case 'Identifier':
        reference(node, parent, key, scope)
        return
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ObjectMethod':
      case 'ClassMethod':
      case 'ClassPrivateMethod':
        if ((node.type === 'ObjectMethod' || node.type === 'ClassMethod') && node.computed)
          visit(node.key, node, 'key', scope)
        visitFunction(node, scope)
        return
      case 'TSDeclareFunction':
      case 'TSDeclareMethod':
        return
      case 'BlockStatement':
      case 'StaticBlock':
      case 'TSModuleBlock': {
        const inner = new Scope(scope)
        hoist(node.body, inner, false)
        for (const statement of node.body) visit(statement, node, 'body', inner)
        return
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = new Scope(scope)
        const head = node.type === 'ForStatement' ? node.init : node.left
        if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
          for (const declarator of head.declarations) declare(inner, declarator.id)
        }
        visitChildren(node, inner)
        return
      }
      case 'CatchClause': {
        const inner = new Scope(scope)
        if (node.param) {
          declare(inner, node.param)
          visitPattern(node.param, inner)
        }
        visit(node.body, node, 'body', inner)
        return
      }
      case 'SwitchStatement': {
        visit(node.discriminant, node, 'discriminant', scope)
        const inner = new Scope(scope)
        hoist(node.cases.flatMap(item => item.consequent), inner, false)
        for (const item of node.cases) visitChildren(item, inner)
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const inner = new Scope(scope)
        if (node.id)
          inner.names.set(node.id.name, 'local')
        visitChildren(node, inner, new Set(['id']))
        return
      }
      case 'VariableDeclaration':
        for (const declarator of node.declarations) {
          visitPattern(declarator.id, scope)
          if (declarator.init)
            visit(declarator.init, declarator, 'init', scope)
        }
        return
      case 'ObjectProperty':
        if (node.computed)
          visit(node.key, node, 'key', scope)
        visit(node.value, node, 'value', scope)
        return
      case 'ClassProperty':
      case 'ClassPrivateProperty':
      case 'ClassAccessorProperty':
      case 'TSPropertySignature':
      case 'TSMethodSignature':
        visitChildren(node, scope, (node as { computed?: boolean }).computed ? new Set() : new Set(['key']))
        return
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const object = unwrap(node.object)
        if (object.type === 'Identifier' && globalObjects.has(object.name) && !scope.lookup(object.name)) {
          if (!node.computed && node.property.type === 'Identifier' && node.property.name === oldName)
            edits.push({ start: node.property.start!, end: node.property.end!, text: newName })
          else if (node.computed && stringValue(node.property) === oldName)
            renameString(node.property)
        }
        visit(node.object, node, 'object', scope)
        if (node.computed)
          visit(node.property, node, 'property', scope)
        return
      }
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const callee = unwrap(node.callee)
        const calleeName = callee.type === 'Identifier' ? callee.name : (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && callee.property.type === 'Identifier' ? callee.property.name : undefined
        const first = node.arguments[0]
        if (calleeName && stubCalls.has(calleeName) && first && stringValue(first) === oldName)
          renameString(first)
        if (callee.type === 'Import' || (callee.type === 'Identifier' && callee.name === 'require' && !scope.lookup('require')))
          moduleRequest(first)
        markFactoryCall(callee, node.arguments, scope)
        eventArgument(node, scope)
        visitChildren(node, scope)
        return
      }
      case 'ImportExpression':
        moduleRequest(node.source)
        visitChildren(node, scope)
        return
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        if (node.source && (isModuleName(node.source.value) || node.source.value.startsWith(aliasPrefix)))
          stopAt(node.start!, `re-exports ${node.source.value}, which goes away with the module. Replace it by hand`)
        if (node.type === 'ExportNamedDeclaration' && node.source)
          return
        visitChildren(node, scope)
        return
      case 'ExportSpecifier':
        visit(node.local, node, 'local', scope)
        return
      case 'LabeledStatement':
        visit(node.body, node, 'body', scope)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return
      case 'TSTypeReference':
        visitChildren(node, scope, new Set(['typeName']))
        return
      case 'TSQualifiedName':
        visit(node.left, node, 'left', scope)
        return
      case 'TSInterfaceDeclaration':
      case 'TSTypeAliasDeclaration':
      case 'TSEnumDeclaration':
      case 'TSModuleDeclaration':
      case 'TSEnumMember':
        visitChildren(node, scope, new Set(['id']))
        return
      case 'TSTypeParameter':
        visitChildren(node, scope, new Set(['name']))
        return
      default:
        visitChildren(node, scope)
    }
  }

  function moduleRequest(source: Node | undefined): void {
    const value = stringValue(source)
    if (source && value && (isModuleName(value) || value.startsWith(aliasPrefix)) && value !== `${moduleName}/eslint`)
      stopAt(source.start!, `loads ${value}, which goes away with the module. Replace it by hand`)
  }

  const moduleScope = new Scope()
  hoist(program.program.body, moduleScope, true)
  for (const statement of program.program.body) visit(statement, program.program, 'body', moduleScope)

  removeDuplicateStubs(program, code, edits, path, report)

  const editor = new Editor(code)
  for (const edit of [...edits, ...specifierEdits]) editor.replace(edit.start, edit.end, edit.text)
  for (const [declaration, specifiers] of removals) removeImportSpecifiers(editor, declaration, specifiers)
  return removeDisableComments(editor.toString())
}

/** The renamed text of `node`, with the edits that fall inside it applied. */
function renamedText(code: string, node: Node, edits: readonly TextEdit[]): string {
  let output = ''
  let cursor = node.start!
  for (const edit of [...edits].filter(edit => edit.start >= node.start! && edit.end <= node.end!).sort((a, b) => a.start - b.start)) {
    output += code.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return (output + code.slice(cursor, node.end!)).replace(/\s+/g, ' ')
}

/** The expression of a statement that stubs the global composable: a stub call or an assignment to `globalThis.*`. */
function stubExpression(statement: Node): Node | undefined {
  if (statement.type !== 'ExpressionStatement')
    return undefined
  const expression = unwrap(statement.expression)
  if (expression.type === 'CallExpression') {
    const callee = unwrap(expression.callee)
    const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : undefined
    const first = expression.arguments[0]
    return name && stubCalls.has(name) && first && [oldName, newName].includes(stringValue(first) ?? '') ? statement.expression : undefined
  }
  if (expression.type === 'AssignmentExpression') {
    const left = unwrap(expression.left)
    if (left.type === 'MemberExpression' && unwrap(left.object).type === 'Identifier' && globalObjects.has((unwrap(left.object) as { name: string }).name)) {
      const property = left.computed ? stringValue(left.property) : left.property.type === 'Identifier' ? left.property.name : undefined
      return property === oldName || property === newName ? statement.expression : undefined
    }
  }
  return undefined
}

/**
 * After the rename, a test that stubbed both names stubs useRuntimeConfig twice in a row. Removes the second stub when
 * it matches the first, and asks for a look when they differ.
 */
function removeDuplicateStubs(program: File, code: string, edits: TextEdit[], path: string, report: Report): void {
  const lists: Node[][] = []
  const collect = (node: Node): void => {
    if (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock')
      lists.push(node.body)
    else if (node.type === 'SwitchCase')
      lists.push(node.consequent)
    for (const { child } of children(node)) collect(child)
  }
  collect(program.program)
  for (const list of lists) {
    for (let index = 1; index < list.length; index++) {
      const previous = stubExpression(list[index - 1]!)
      const current = stubExpression(list[index]!)
      if (!previous || !current || previous.type !== current.type)
        continue
      const touched = edits.some(edit => (edit.start >= current.start! && edit.end <= current.end!) || (edit.start >= previous.start! && edit.end <= previous.end!))
      if (!touched)
        continue
      if (renamedText(code, previous, edits) !== renamedText(code, current, edits)) {
        report.manual.push({ file: path, line: lineAt(code, current.start!), text: `stubs ${newName} right after another stub of it. Keep one` })
        continue
      }
      // Remove the expression, not the statement: a statement can end with the `;` that guards the next line.
      let from = current.start!
      let to = current.end!
      for (let position = edits.length - 1; position >= 0; position--) {
        if (edits[position]!.start >= from && edits[position]!.end <= to)
          edits.splice(position, 1)
      }
      const lineFrom = lineStart(code, from)
      if (!code.slice(lineFrom, from).trim()) {
        from = lineFrom
        const lineTo = lineEnd(code, to)
        if (!code.slice(to, lineTo).trim())
          to = lineTo
      }
      edits.push({ start: from, end: to, text: '' })
      list.splice(index, 1)
      index--
    }
  }
}
