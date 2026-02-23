import type { Nuxt } from '@nuxt/schema'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrompt = vi.fn()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  box: vi.fn(),
}
vi.mock('consola', () => ({
  consola: {
    prompt: (...args: unknown[]) => mockPrompt(...args),
    withTag: () => mockLogger,
  },
}))

const mockFetch = vi.fn()
vi.mock('ofetch', () => ({
  $fetch: (...args: unknown[]) => mockFetch(...args),
}))

let mockShelveRc: Record<string, string> = {}
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return {
    ...original,
    homedir: () => '/mock-home',
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    existsSync: (path: string) => {
      if (path === '/mock-home/.shelve')
        return Object.keys(mockShelveRc).length > 0
      return original.existsSync(path)
    },
    readFileSync: (path: string, encoding?: string) => {
      if (path === '/mock-home/.shelve') {
        return Object.entries(mockShelveRc).map(([k, v]) => `${k}=${v}`).join('\n')
      }
      return original.readFileSync(path, encoding as BufferEncoding)
    },
    writeFileSync: (path: string, content: string) => {
      if (path === '/mock-home/.shelve') {
        mockShelveRc = {}
        for (const line of content.split('\n')) {
          const match = line.match(/^(\w+)=(.+)$/)
          if (match)
            mockShelveRc[match[1]] = match[2]
        }
        return
      }
      return original.writeFileSync(path, content)
    },
  }
})

const { runShelveWizard } = await import('../src/wizard/shelve-setup')

describe('shelve wizard', () => {
  let testDir: string
  let nuxtConfig: string

  beforeEach(() => {
    testDir = join(tmpdir(), `wizard-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    nuxtConfig = join(testDir, 'nuxt.config.ts')
    writeFileSync(nuxtConfig, `export default defineNuxtConfig({\n  modules: ['nuxt-safe-runtime-config'],\n})`)
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ devDependencies: { valibot: '1.0.0' } }))

    mockPrompt.mockReset()
    mockFetch.mockReset()
    mockShelveRc = {}
    for (const fn of Object.values(mockLogger)) {
      fn.mockReset()
    }
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function createMockNuxt(overrides: Partial<Nuxt['options']> = {}): Nuxt {
    return {
      options: {
        rootDir: testDir,
        safeRuntimeConfig: {},
        ...overrides,
      },
    } as unknown as Nuxt
  }

  function queuePrompts(...responses: unknown[]): void {
    for (const response of responses) {
      mockPrompt.mockResolvedValueOnce(response)
    }
  }

  it('generates schema only when user declines Shelve integration', async () => {
    queuePrompts(false, true)

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).not.toHaveBeenCalled()
    const config = readFileSync(nuxtConfig, 'utf-8')
    expect(config).toContain('valibot')
    expect(config).toContain('$schema')
    expect(config).toContain('v.object')
    expect(config).not.toContain('shelve')
  })

  it('skips when already configured', async () => {
    const nuxt = createMockNuxt({
      safeRuntimeConfig: { shelve: { project: 'existing', slug: 'team' } },
    } as any)

    await runShelveWizard(nuxt)

    expect(mockPrompt).not.toHaveBeenCalled()
  })

  it('shows plan and cancels without mutating files', async () => {
    queuePrompts(false, false)

    await runShelveWizard(createMockNuxt())

    const config = readFileSync(nuxtConfig, 'utf-8')
    expect(config).not.toContain('$schema')
    expect(mockLogger.info).toHaveBeenCalledWith('Planned changes:')
    expect(mockLogger.info).toHaveBeenCalledWith('Setup cancelled. No changes were made.')
  })

  it('does not persist new token when user cancels', async () => {
    queuePrompts(true, 'test-token', false)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    expect(mockShelveRc.token).toBeUndefined()
    expect(readFileSync(nuxtConfig, 'utf-8')).not.toContain('safeRuntimeConfig')
  })

  it('prompts for token when not logged in', async () => {
    queuePrompts(true, 'test-token', true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/user/me',
      expect.objectContaining({ headers: { Cookie: 'authToken=test-token' } }),
    )
    expect(mockShelveRc.token).toBe('test-token')
  })

  it('uses existing token from ~/.shelve', async () => {
    mockShelveRc = { token: 'existing-token', username: 'saveduser', email: 'saved@example.com' }
    queuePrompts(true, true)

    mockFetch
      .mockResolvedValueOnce({ username: 'saveduser', email: 'saved@example.com' })
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/user/me',
      expect.objectContaining({ headers: { Cookie: 'authToken=existing-token' } }),
    )
    expect(mockPrompt).toHaveBeenCalledTimes(2)
    expect(mockShelveRc.token).toBe('existing-token')
  })

  it('handles no teams found', async () => {
    queuePrompts(true, 'test-token', true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([])

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(readFileSync(nuxtConfig, 'utf-8')).toContain('$schema')
  })

  it('handles team fetch failure', async () => {
    queuePrompts(true, 'test-token', true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockRejectedValueOnce(new Error('API error'))

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(readFileSync(nuxtConfig, 'utf-8')).toContain('$schema')
  })

  it('auto-selects single team', async () => {
    mockShelveRc = { token: 'test-token' }
    queuePrompts(true, true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([{ slug: 'only-team', name: 'Only Team' }])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    expect(mockPrompt).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/teams/only-team/projects',
      expect.anything(),
    )
  })

  it('prompts for team selection when multiple teams', async () => {
    mockShelveRc = { token: 'test-token' }
    queuePrompts(true, 'team-b', true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([
        { slug: 'team-a', name: 'Team A' },
        { slug: 'team-b', name: 'Team B' },
      ])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    expect(mockPrompt).toHaveBeenCalledWith('Select team:', expect.objectContaining({
      type: 'select',
      options: expect.arrayContaining([
        expect.objectContaining({ label: 'Team A', value: 'team-a' }),
        expect.objectContaining({ label: 'Team B', value: 'team-b' }),
      ]),
    }))
  })

  it('updates nuxt.config.ts on successful setup', async () => {
    mockShelveRc = { token: 'test-token' }
    queuePrompts(true, true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }])
      .mockResolvedValueOnce([{ id: 42, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())

    const updatedConfig = readFileSync(nuxtConfig, 'utf-8')
    expect(updatedConfig).toContain('safeRuntimeConfig')
    expect(updatedConfig).toContain('shelve')
    expect(updatedConfig).toContain('my-project')
    expect(updatedConfig).toContain('my-team')
    expect(updatedConfig).toContain('valibot')
    expect(updatedConfig).toContain('apiKey')
    expect(mockLogger.info).toHaveBeenCalledWith('Planned changes:')
  })
})
