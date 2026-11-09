import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => ({ warn, error: vi.fn(), info: vi.fn(), success: vi.fn() }),
}))

const { default: module } = await import('../src/module')

function nuxtWithVersion(version: string): Nuxt {
  return { _version: version, options: {} } as unknown as Nuxt
}

describe('viteHub Env recommendation', () => {
  it('stays quiet on Nuxt 4', async () => {
    warn.mockClear()
    await module.onInstall?.(nuxtWithVersion('4.5.0'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('names the codemod on Nuxt 5 install and upgrade', async () => {
    warn.mockClear()
    await module.onInstall?.(nuxtWithVersion('5.0.0'))
    await module.onUpgrade?.(nuxtWithVersion('5.0.0'), {}, '0.3.2')
    expect(warn).toHaveBeenCalledTimes(2)
    const message = String(warn.mock.calls[0]![0])
    expect(message.split('\n')).toHaveLength(2)
    expect(message).toContain('npx @vite-hub/codemods nuxt-safe-runtime-config')
  })
})
