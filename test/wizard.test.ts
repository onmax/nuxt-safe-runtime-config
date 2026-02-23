import type { Nuxt } from '@nuxt/schema'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrompt = vi.fn()
vi.mock('consola', () => ({
  consola: {
    prompt: (...args: unknown[]) => mockPrompt(...args),
    withTag: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      box: vi.fn(),
    }),
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
    writeFileSync(nuxtConfig, `export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
})`)
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ devDependencies: { valibot: '1.0.0' } }))
    mockPrompt.mockReset()
    mockFetch.mockReset()
    mockShelveRc = {}
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

  it('generates schema only when user declines Shelve integration', async () => {
    mockPrompt.mockResolvedValueOnce(false)

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

  it('prompts for token when not logged in', async () => {
    mockPrompt
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('test-token')

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
  })

  it('uses existing token from ~/.shelve', async () => {
    mockShelveRc = { token: 'existing-token', username: 'saveduser', email: 'saved@example.com' }

    mockPrompt.mockResolvedValueOnce(true)

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
    expect(mockPrompt).toHaveBeenCalledTimes(1)
  })

  it('handles no teams found', async () => {
    mockPrompt
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('test-token')

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([])

    await runShelveWizard(createMockNuxt())
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('handles undefined teams from API', async () => {
    mockPrompt
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('test-token')

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockRejectedValueOnce(new Error('API error'))

    await runShelveWizard(createMockNuxt())
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('auto-selects single team', async () => {
    mockShelveRc = { token: 'test-token' }

    mockPrompt.mockResolvedValueOnce(true)

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' })
      .mockResolvedValueOnce([{ slug: 'only-team', name: 'Only Team' }])
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }])
      .mockResolvedValueOnce({ id: 1, name: 'development' })
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }])

    await runShelveWizard(createMockNuxt())
    expect(mockPrompt).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/teams/only-team/projects',
      expect.anything(),
    )
  })

  it('prompts for team selection when multiple teams', async () => {
    mockShelveRc = { token: 'test-token' }

    mockPrompt
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('team-b')

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

    mockPrompt.mockResolvedValueOnce(true)

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
  })
})
