import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSecretsCache, normalizeShelveOptions, resolveShelveConfig, shouldEnableShelve } from '../src/providers/shelve'

// Mock homedir to return a temp directory that doesn't have .shelve
const mockHomeDir = join(tmpdir(), `shelve-home-${randomUUID()}`)
vi.mock('node:os', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:os')>()
  return { ...mod, homedir: () => mockHomeDir }
})

describe('normalizeShelveOptions', () => {
  it('returns empty object for true', () => {
    expect(normalizeShelveOptions(true)).toEqual({})
  })

  it('returns empty object for undefined', () => {
    expect(normalizeShelveOptions(undefined)).toEqual({})
  })

  it('returns { enabled: false } for false', () => {
    expect(normalizeShelveOptions(false)).toEqual({ enabled: false })
  })

  it('returns object as-is', () => {
    const options = { project: 'my-project', slug: 'my-team' }
    expect(normalizeShelveOptions(options)).toEqual(options)
  })
})

describe('shouldEnableShelve', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `shelve-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns false when options is false', () => {
    expect(shouldEnableShelve(false, testDir)).toBe(false)
  })

  it('returns false when options is undefined', () => {
    expect(shouldEnableShelve(undefined, testDir)).toBe(false)
  })

  it('returns true when options is true', () => {
    expect(shouldEnableShelve(true, testDir)).toBe(true)
  })

  it('returns false when enabled is explicitly false', () => {
    expect(shouldEnableShelve({ enabled: false, project: 'test', slug: 'team' }, testDir)).toBe(false)
  })

  it('returns true when enabled is true', () => {
    expect(shouldEnableShelve({ enabled: true }, testDir)).toBe(true)
  })

  it('returns true when project is set (implies enabled)', () => {
    expect(shouldEnableShelve({ project: 'my-project' }, testDir)).toBe(true)
  })

  it('returns true when slug is set (implies enabled)', () => {
    expect(shouldEnableShelve({ slug: 'my-team' }, testDir)).toBe(true)
  })

  it('returns true when team is set (implies enabled)', () => {
    expect(shouldEnableShelve({ team: 'my-team' }, testDir)).toBe(true)
  })

  it('returns false for empty object', () => {
    expect(shouldEnableShelve({}, testDir)).toBe(false)
  })
})

describe('resolveShelveConfig', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `shelve-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    // Ensure mock home dir exists but has no .shelve file
    mkdirSync(mockHomeDir, { recursive: true })
    vi.stubEnv('SHELVE_TOKEN', 'test-token')
    vi.stubEnv('SHELVE_PROJECT', '')
    vi.stubEnv('SHELVE_TEAM', '')
    vi.stubEnv('SHELVE_TEAM_SLUG', '')
    vi.stubEnv('SHELVE_ENV', '')
    vi.stubEnv('SHELVE_URL', '')
    clearSecretsCache()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(mockHomeDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('throws if project name cannot be resolved', () => {
    expect(() => resolveShelveConfig({ slug: 'team' }, testDir, true))
      .toThrow('Shelve project name required')
  })

  it('throws if team slug cannot be resolved', () => {
    writeFileSync(join(testDir, 'package.json'), '{"name": "my-project"}')
    expect(() => resolveShelveConfig({}, testDir, true))
      .toThrow('Shelve team slug required')
  })

  it('throws if token is missing', () => {
    vi.stubEnv('SHELVE_TOKEN', '')
    delete process.env.SHELVE_TOKEN
    writeFileSync(join(testDir, 'package.json'), '{"name": "my-project"}')

    expect(() => resolveShelveConfig({ slug: 'team' }, testDir, true))
      .toThrow('Shelve token required')
  })

  it('uses token from ~/.shelve when env is not set', () => {
    vi.stubEnv('SHELVE_TOKEN', '')
    delete process.env.SHELVE_TOKEN
    writeFileSync(join(mockHomeDir, '.shelve'), 'token=file-token')
    writeFileSync(join(testDir, 'package.json'), '{"name": "my-project"}')

    const config = resolveShelveConfig({ slug: 'team' }, testDir, true)
    expect(config.token).toBe('file-token')
  })

  it('resolves project from options', () => {
    const config = resolveShelveConfig({ project: 'my-project', slug: 'team' }, testDir, true)
    expect(config.project).toBe('my-project')
  })

  it('resolves project from SHELVE_PROJECT env', () => {
    vi.stubEnv('SHELVE_PROJECT', 'env-project')
    const config = resolveShelveConfig({ slug: 'team' }, testDir, true)
    expect(config.project).toBe('env-project')
  })

  it('resolves project from package.json name', () => {
    writeFileSync(join(testDir, 'package.json'), '{"name": "pkg-project"}')
    const config = resolveShelveConfig({ slug: 'team' }, testDir, true)
    expect(config.project).toBe('pkg-project')
  })

  it('resolves slug from options', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'my-team' }, testDir, true)
    expect(config.slug).toBe('my-team')
  })

  it('resolves slug from team alias', () => {
    const config = resolveShelveConfig({ project: 'proj', team: 'alias-team' }, testDir, true)
    expect(config.slug).toBe('alias-team')
  })

  it('resolves slug from SHELVE_TEAM env', () => {
    vi.stubEnv('SHELVE_TEAM', 'env-team')
    const config = resolveShelveConfig({ project: 'proj' }, testDir, true)
    expect(config.slug).toBe('env-team')
  })

  it('resolves slug from SHELVE_TEAM_SLUG env', () => {
    vi.stubEnv('SHELVE_TEAM_SLUG', 'env-slug-team')
    const config = resolveShelveConfig({ project: 'proj' }, testDir, true)
    expect(config.slug).toBe('env-slug-team')
  })

  it('uses development environment in dev mode', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, true)
    expect(config.environment).toBe('development')
  })

  it('uses production environment in production mode', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, false)
    expect(config.environment).toBe('production')
  })

  it('resolves environment from options', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team', environment: 'staging' }, testDir, true)
    expect(config.environment).toBe('staging')
  })

  it('resolves environment from SHELVE_ENV', () => {
    vi.stubEnv('SHELVE_ENV', 'preview')
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, true)
    expect(config.environment).toBe('preview')
  })

  it('uses default URL', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, true)
    expect(config.url).toBe('https://app.shelve.cloud')
  })

  it('resolves URL from options', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team', url: 'https://custom.shelve.io' }, testDir, true)
    expect(config.url).toBe('https://custom.shelve.io')
  })

  it('resolves URL from SHELVE_URL env', () => {
    vi.stubEnv('SHELVE_URL', 'https://env.shelve.io')
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, true)
    expect(config.url).toBe('https://env.shelve.io')
  })

  it('strips trailing slashes from URL', () => {
    const config = resolveShelveConfig({ project: 'proj', slug: 'team', url: 'https://custom.shelve.io///' }, testDir, true)
    expect(config.url).toBe('https://custom.shelve.io')
  })

  it('resolves token from SHELVE_TOKEN', () => {
    vi.stubEnv('SHELVE_TOKEN', 'env-token')
    const config = resolveShelveConfig({ project: 'proj', slug: 'team' }, testDir, true)
    expect(config.token).toBe('env-token')
  })

  it('priority: options > env > package.json', () => {
    vi.stubEnv('SHELVE_PROJECT', 'env-project')
    writeFileSync(join(testDir, 'package.json'), '{"name": "pkg-project"}')

    // Options takes priority
    let config = resolveShelveConfig({ project: 'opt-project', slug: 'team' }, testDir, true)
    expect(config.project).toBe('opt-project')

    // Env takes priority over pkg
    config = resolveShelveConfig({ slug: 'team' }, testDir, true)
    expect(config.project).toBe('env-project')
  })
})
