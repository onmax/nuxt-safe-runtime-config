import type { MigrateResult } from '../../src/migrate'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../../src/migrate'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = join(here, 'fixtures')
const tmpDir = join(here, '.tmp', 'migrate')
const fixtures = readdirSync(fixturesDir).sort()

function listTree(dir: string): string[] {
  if (!existsSync(dir))
    return []
  const files: string[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules')
        continue
      const path = join(current, entry.name)
      if (entry.isDirectory())
        visit(path)
      else
        files.push(relative(dir, path))
    }
  }
  visit(dir)
  return files.sort()
}

function readTree(dir: string): Record<string, string> {
  return Object.fromEntries(listTree(dir).map(path => [path, readFileSync(join(dir, path), 'utf8')]))
}

/** Copies a fixture input and installs a stub `nuxt` package at the version its range names. */
function prepare(name: string, suffix = ''): string {
  const dir = join(tmpDir, `${name}${suffix}`)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(fixturesDir, name, 'input'), dir, { recursive: true })
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const range: string = pkg.dependencies?.nuxt ?? pkg.devDependencies?.nuxt ?? ''
  const version = /\d+\.\d+\.\d+/.exec(range)?.[0] ?? '4.7.0'
  mkdirSync(join(dir, 'node_modules/nuxt'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/nuxt/package.json'), JSON.stringify({ name: 'nuxt', version }))
  return dir
}

function reportText(result: MigrateResult): string {
  return [`status: ${result.status}`, '', result.output, ''].join('\n')
}

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('migrate fixtures', () => {
  it.each(fixtures)('%s', async (name) => {
    const dir = prepare(name)
    const input = readTree(dir)
    const result = await migrate(dir)
    await expect(reportText(result)).toMatchFileSnapshot(join(fixturesDir, name, 'report.txt'))

    const outputDir = join(fixturesDir, name, 'output')
    if (result.status !== 'migrated') {
      expect(result.edits).toEqual([])
      expect(readTree(dir)).toEqual(input)
      expect(existsSync(outputDir)).toBe(false)
      return
    }
    const files = listTree(dir)
    for (const path of files)
      await expect(readFileSync(join(dir, path), 'utf8')).toMatchFileSnapshot(join(outputDir, path))
    for (const path of listTree(outputDir))
      expect(files, `${path} is in output/ but the codemod did not produce it`).toContain(path)
  }, 60_000)
})

describe('idempotency', () => {
  const migrated = fixtures.filter(name => existsSync(join(fixturesDir, name, 'output')))

  it('has migrated fixtures to check', () => {
    expect(migrated.length).toBeGreaterThan(10)
  })

  it.each(migrated)('%s changes nothing on a second run', async (name) => {
    const dir = prepare(name, '-twice')
    await migrate(dir)
    const once = readTree(dir)
    const second = await migrate(dir)
    expect(second.status).toBe('nothing')
    expect(second.edits).toEqual([])
    expect(readTree(dir)).toEqual(once)
  }, 60_000)
})

describe('dry run', () => {
  it('writes nothing and prints a diff', async () => {
    const dir = prepare('valibot-named-direct', '-dry')
    const input = readTree(dir)
    const result = await migrate(dir, { dryRun: true })
    expect(result.status).toBe('migrated')
    expect(readTree(dir)).toEqual(input)
    expect(result.output).toContain('Dry run: nothing was written.')
    expect(result.output).toContain('--- a/nuxt.config.ts\n+++ b/nuxt.config.ts\n@@')
    expect(result.output).toMatchSnapshot()
  }, 60_000)

  it('shows a created layer and a deleted .nuxtrc', async () => {
    const dir = prepare('zod-nested-const', '-dry')
    const input = readTree(dir)
    const result = await migrate(dir, { dryRun: true })
    expect(readTree(dir)).toEqual(input)
    expect(result.output).toContain('--- /dev/null\n+++ b/layers/runtime-config/nuxt.config.ts')
    expect(result.output).toContain('--- a/.nuxtrc\n+++ /dev/null')
  }, 60_000)

  it('stops without writing', async () => {
    const dir = prepare('stop-zod-transform', '-dry')
    const input = readTree(dir)
    const result = await migrate(dir, { dryRun: true })
    expect(result.status).toBe('stopped')
    expect(readTree(dir)).toEqual(input)
  }, 60_000)
})
