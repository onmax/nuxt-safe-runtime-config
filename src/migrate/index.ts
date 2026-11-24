import type { FileEdit, Note, Report } from './report'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { tidyBlankLines } from './ast'
import { findConfigFile, layerConfigPath, migrateConfig } from './config'
import { unifiedDiff } from './diff'
import { dependencySections, dependencyVersion, findMentions, installCommand, isCodeFile, isEslintConfig, listFiles, meetsMinimum, migrateEslintConfig, migrateNuxtrc, migratePackageJson, migrateTsconfig, moduleName, nitroMajor } from './project'
import { createReport, formatNote } from './report'
import { migrateSource } from './source'

export type { FileEdit, Note, Report }

export interface MigrateOptions {
  dryRun?: boolean
}

export interface MigrateResult {
  status: 'migrated' | 'nothing' | 'stopped'
  edits: FileEdit[]
  report: Report
  /** What the command prints: the summary, and the diff in a dry run. */
  output: string
}

const manualSteps = [
  'Move each safeRuntimeConfig.$schema to runtimeConfig. Wrap a Valibot schema in toStandardJsonSchema() from @valibot/to-json-schema.',
  'Drop \'\' placeholders for keys the schema requires. If other plain values stay in runtimeConfig, put the schema in layers/runtime-config/nuxt.config.ts instead.',
  'Rename useSafeRuntimeConfig to useRuntimeConfig.',
  `Remove ${moduleName} from package.json, modules, eslint.config and .nuxtrc.`,
]

export async function migrate(dir: string, options: MigrateOptions = {}): Promise<MigrateResult> {
  const rootDir = resolve(dir)
  const report = createReport()
  const finish = (status: MigrateResult['status'], edits: FileEdit[], next: string[] = []): MigrateResult => ({
    status,
    edits,
    report,
    output: formatOutput(status, edits, report, next, options.dryRun),
  })

  const pkgPath = join(rootDir, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, any> : undefined
  const configFile = findConfigFile(rootDir)
  const configCode = configFile ? readFileSync(configFile, 'utf8') : ''
  const hasDependency = !!pkg && dependencySections.some(section => pkg[section]?.[moduleName] !== undefined)
  if (!hasDependency && !/safeRuntimeConfig|nuxt-safe-runtime-config/.test(configCode))
    return finish('nothing', [])
  if (!pkg || !configFile) {
    report.stops.push({ text: `${relative(process.cwd(), rootDir) || '.'} has no ${pkg ? 'nuxt.config' : 'package.json'}. Run the command in the Nuxt app's directory` })
    return finish('stopped', [])
  }

  const nuxt = dependencyVersion(rootDir, pkg, 'nuxt')
  if (!meetsMinimum(nuxt, '4.7.0')) {
    const found = !nuxt ? 'Nuxt is not in package.json' : nuxt.installed ? `Nuxt ${nuxt.text} is installed` : `package.json asks for Nuxt ${nuxt.text}, which allows ${nuxt.version ? `versions down to ${nuxt.version}` : 'versions the codemod can\'t read'}`
    report.stops.push({ text: `${found}. Nuxt runtimeConfig schemas need Nuxt 4.7 or newer. Run \`npx nuxt upgrade\`, then run this command again` })
    return finish('stopped', [])
  }

  const files = listFiles(rootDir)
  const texts = new Map<string, string>()
  const read = (path: string): string => {
    let text = texts.get(path)
    if (text === undefined) {
      text = readFileSync(join(rootDir, path), 'utf8')
      texts.set(path, text)
    }
    return text
  }
  for (const path of files.filter(isCodeFile)) {
    const text = read(path)
    for (const [index, lineText] of text.split('\n').entries()) {
      if (lineText.includes(`${moduleName}/nitro`))
        report.stops.push({ file: path, line: index + 1, text: `uses ${moduleName}/nitro. Nuxt runtimeConfig schemas don't cover standalone Nitro, so migrate it by hand` })
    }
  }

  const configResult = await migrateConfig(rootDir, configFile, report)
  if (report.stops.length || !configResult)
    return finish('stopped', [], report.stops.length ? manualSteps : [])

  const edits: FileEdit[] = [...configResult.edits]
  // Nitro 2's useRuntimeConfig() takes the request event. Nitro 3's doesn't, so the call keeps no arguments unless Nitro 2 is certain.
  const eventArgument = !meetsMinimum(nuxt, '5.0.0-0') && nitroMajor(rootDir, pkg) === 2
  const configPath = relative(rootDir, configFile)
  for (const path of files) {
    if (path === configPath || path === layerConfigPath)
      continue
    if (isEslintConfig(path)) {
      const before = read(path)
      const after = migrateEslintConfig(path, before, report)
      if (after !== undefined && after !== before)
        edits.push({ path, before, after })
      continue
    }
    if (isCodeFile(path)) {
      const before = read(path)
      if (!/useSafeRuntimeConfig|safe-runtime-config\/|nuxt-safe-runtime-config/.test(before))
        continue
      const after = migrateSource(path, before, report, { eventArgument })
      if (after !== before)
        edits.push({ path, before, after })
    }
  }
  for (const edit of [
    ...migratePackageJson(rootDir, configResult.valibot, report),
    migrateNuxtrc(rootDir),
    ...files.filter(path => /^tsconfig(?:\.[\w-]+)?\.json$/.test(path)).map(path => migrateTsconfig(rootDir, path)),
  ]) {
    if (edit)
      edits.push(edit)
  }
  for (const edit of edits) {
    // pnpm-workspace.yaml may sit above the app, at the root of its workspace.
    const base = edit.path.startsWith('../') ? dirname(join(rootDir, edit.path)) : rootDir
    if (!insideApp(base, relative(base, join(rootDir, edit.path))))
      report.stops.push({ file: edit.path, text: 'is outside the app through a symbolic link, so the codemod won\'t write it' })
  }
  if (report.stops.length)
    return finish('stopped', [], manualSteps)

  for (const edit of edits) {
    if (edit.before !== null && edit.after !== null && isCodeFile(edit.path))
      edit.after = tidyBlankLines(edit.before, edit.after)
  }
  const editsByPath = new Map(edits.map(edit => [edit.path, edit]))
  const finalText = (path: string): string | undefined => {
    const edit = editsByPath.get(path)
    if (edit)
      return edit.after ?? undefined
    return existsSync(join(rootDir, path)) ? read(path) : undefined
  }
  configResult.finish(finalText)
  report.refinements.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0))
  const reported = new Set(report.manual.map(note => `${note.file}:${note.line}`))
  for (const note of findMentions(files, finalText, path => path === 'package.json' || path === '.nuxtrc')) {
    if (!reported.has(`${note.file}:${note.line}`))
      report.manual.push(note)
  }

  if (!options.dryRun) {
    for (const edit of edits) {
      const path = join(rootDir, edit.path)
      if (edit.after === null) {
        rmSync(path, { force: true })
      }
      else {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, edit.after)
      }
    }
  }
  return finish('migrated', edits, [
    `Run \`${installCommand(rootDir)}\` to update the lockfile.`,
    'Run your typecheck. Nuxt now types runtimeConfig from the schema, so plain values in nuxt.config and code that reads them can fail it.',
    'Run your linter with --fix. The files the codemod wrote may not match your code style.',
    'Run `nuxt build`. Set every required NUXT_* variable when the server starts, or it exits with NUXT_E8014.',
  ])
}

/** Said wherever --dry-run is described: reading the schema means running nuxt.config, as `nuxt build` does. */
export const dryRunNote = 'loaded nuxt.config the way Nuxt does, so code in it and in the files it imports ran.'

/** Whether `path` stays inside `rootDir` once symbolic links in its existing part are resolved. */
function insideApp(rootDir: string, path: string): boolean {
  let existing = join(rootDir, path)
  while (!existsSync(existing) && existing !== dirname(existing))
    existing = dirname(existing)
  const root = realpathSync(rootDir)
  const target = realpathSync(existing)
  return target === root || target.startsWith(root + sep)
}

function section(title: string, notes: Note[]): string[] {
  if (!notes.length)
    return []
  return ['', title, ...notes.map(note => `  - ${formatNote(note)}`)]
}

export function formatOutput(status: MigrateResult['status'], edits: FileEdit[], report: Report, next: string[], dryRun = false): string {
  if (status === 'nothing')
    return `Nothing to migrate: ${moduleName} is not in package.json or nuxt.config.`
  if (status === 'stopped') {
    return [
      `Stopped. The codemod changed nothing.`,
      ...report.stops.map(note => `  - ${formatNote(note)}.`),
      ...(next.length ? ['', 'Do this by hand instead:', ...next.map((step, index) => `  ${index + 1}. ${step}`)] : []),
    ].join('\n')
  }
  const verb = dryRun ? 'Would change' : 'Changed'
  const lines = [
    `${dryRun ? `Dry run: nothing was written. The codemod ${dryRunNote}` : `Migrated ${moduleName} to Nuxt runtimeConfig schemas.`}`,
    '',
    `${verb}:`,
    ...edits.map(edit => `  ${edit.before === null ? 'create' : edit.after === null ? 'delete' : 'modify'} ${edit.path}`),
    ...section('Now required at startup. The codemod removed the \'\' placeholders of these keys, so the server exits with NUXT_E8014 unless their variables are set. To keep a key optional, make it optional in the schema:', report.required),
    ...section('Nuxt does not check these schema rules. Check them in server code where they matter:', report.refinements),
    ...section('Behaviour changes:', report.changes),
    ...section('Check by hand:', report.manual),
    '',
    'Next:',
    ...next.map((step, index) => `  ${index + 1}. ${step}`),
  ]
  if (dryRun)
    lines.push('', ...edits.map(edit => unifiedDiff(edit)))
  return lines.join('\n')
}
