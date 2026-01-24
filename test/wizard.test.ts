import type { Nuxt } from '@nuxt/schema'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock consola before importing the wizard
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

// Mock ofetch
const mockFetch = vi.fn()
vi.mock('ofetch', () => ({
  $fetch: (...args: unknown[]) => mockFetch(...args),
}))

// Mock fs functions for ~/.shelve
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
    // Create temp directory with nuxt.config.ts and package.json (with valibot to skip library prompt)
    testDir = join(tmpdir(), `wizard-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    nuxtConfig = join(testDir, 'nuxt.config.ts')
    writeFileSync(nuxtConfig, `export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
})`)
    // Add package.json with valibot so library detection works (skips library prompt)
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ devDependencies: { valibot: '1.0.0' } }))

    // Reset mocks
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
    mockPrompt.mockResolvedValueOnce(false) // Enable Shelve? No

    await runShelveWizard(createMockNuxt())

    // No Shelve API calls, but config should be updated with schema
    expect(mockFetch).not.toHaveBeenCalled()
    const config = readFileSync(nuxtConfig, 'utf-8')
    expect(config).toContain('valibot') // schema import
    expect(config).toContain('$schema') // inline schema
    expect(config).toContain('v.object') // valibot schema expression
    expect(config).not.toContain('shelve') // no shelve config
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
      .mockResolvedValueOnce(true) // Enable Shelve? Yes
      .mockResolvedValueOnce('test-token') // Enter token

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }]) // fetch teams
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }]) // fetch projects
      .mockResolvedValueOnce({ id: 1, name: 'development' }) // fetch environment
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }]) // fetch variables

    await runShelveWizard(createMockNuxt())

    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/user/me',
      expect.objectContaining({ headers: { Cookie: 'authToken=test-token' } }),
    )
  })

  it('uses existing token from ~/.shelve', async () => {
    mockShelveRc = { token: 'existing-token', username: 'saveduser', email: 'saved@example.com' }

    mockPrompt.mockResolvedValueOnce(true) // Enable Shelve? Yes

    mockFetch
      .mockResolvedValueOnce({ username: 'saveduser', email: 'saved@example.com' }) // validate existing token
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }]) // fetch teams
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }]) // fetch projects
      .mockResolvedValueOnce({ id: 1, name: 'development' }) // fetch environment
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }]) // fetch variables

    await runShelveWizard(createMockNuxt())

    // Should validate existing token, not prompt for new one
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/user/me',
      expect.objectContaining({ headers: { Cookie: 'authToken=existing-token' } }),
    )
    // Should not prompt for token
    expect(mockPrompt).toHaveBeenCalledTimes(1) // Only the "Enable Shelve?" prompt
  })

  it('handles no teams found', async () => {
    mockPrompt
      .mockResolvedValueOnce(true) // Enable Shelve? Yes
      .mockResolvedValueOnce('test-token') // Enter token

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockResolvedValueOnce([]) // fetch teams - empty

    await runShelveWizard(createMockNuxt())

    // Should not proceed to project selection
    expect(mockFetch).toHaveBeenCalledTimes(2) // user/me + teams
  })

  it('handles undefined teams from API', async () => {
    mockPrompt
      .mockResolvedValueOnce(true) // Enable Shelve? Yes
      .mockResolvedValueOnce('test-token') // Enter token

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockRejectedValueOnce(new Error('API error')) // fetch teams fails

    await runShelveWizard(createMockNuxt())

    // Should handle gracefully, not crash
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('auto-selects single team', async () => {
    mockShelveRc = { token: 'test-token' }

    mockPrompt.mockResolvedValueOnce(true) // Enable Shelve? Yes

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockResolvedValueOnce([{ slug: 'only-team', name: 'Only Team' }]) // single team
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }]) // fetch projects
      .mockResolvedValueOnce({ id: 1, name: 'development' }) // fetch environment
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }]) // fetch variables

    await runShelveWizard(createMockNuxt())

    // Should not prompt for team selection when only one team
    expect(mockPrompt).toHaveBeenCalledTimes(1) // Only "Enable Shelve?" prompt
    // Should fetch projects for the auto-selected team
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.shelve.cloud/api/teams/only-team/projects',
      expect.anything(),
    )
  })

  it('prompts for team selection when multiple teams', async () => {
    mockShelveRc = { token: 'test-token' }

    mockPrompt
      .mockResolvedValueOnce(true) // Enable Shelve? Yes
      .mockResolvedValueOnce('team-b') // Select team

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockResolvedValueOnce([
        { slug: 'team-a', name: 'Team A' },
        { slug: 'team-b', name: 'Team B' },
      ]) // multiple teams
      .mockResolvedValueOnce([{ id: 1, name: 'my-project' }]) // fetch projects
      .mockResolvedValueOnce({ id: 1, name: 'development' }) // fetch environment
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }]) // fetch variables

    await runShelveWizard(createMockNuxt())

    // Should prompt for team selection
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

    mockPrompt.mockResolvedValueOnce(true) // Enable Shelve? Yes

    mockFetch
      .mockResolvedValueOnce({ username: 'testuser', email: 'test@example.com' }) // validate token
      .mockResolvedValueOnce([{ slug: 'my-team', name: 'My Team' }]) // single team
      .mockResolvedValueOnce([{ id: 42, name: 'my-project' }]) // single project
      .mockResolvedValueOnce({ id: 1, name: 'development' }) // fetch environment
      .mockResolvedValueOnce([{ key: 'API_KEY', value: 'test' }]) // fetch variables

    await runShelveWizard(createMockNuxt())

    // Check nuxt.config.ts was updated
    const updatedConfig = readFileSync(nuxtConfig, 'utf-8')
    expect(updatedConfig).toContain('safeRuntimeConfig')
    expect(updatedConfig).toContain('shelve')
    expect(updatedConfig).toContain('my-project')
    expect(updatedConfig).toContain('my-team')
    // Should also contain schema with generated types
    expect(updatedConfig).toContain('valibot')
    expect(updatedConfig).toContain('apiKey') // API_KEY -> apiKey
  })
})
