import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it, vi } from 'vitest'

const info = vi.hoisted(() => vi.fn())
vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => ({ info, warn: vi.fn(), error: vi.fn(), success: vi.fn() }),
}))

const { default: module } = await import('../src/module')

function nuxtWithVersion(version: string): Nuxt {
  return { _version: version, options: {} } as unknown as Nuxt
}

describe('nuxt 5 install message', () => {
  it('stays quiet on Nuxt 4', async () => {
    info.mockClear()
    await module.onInstall?.(nuxtWithVersion('4.5.0'))
    expect(info).not.toHaveBeenCalled()
  })

  it('explains native schemas and links the guide on Nuxt 5 install and upgrade', async () => {
    info.mockClear()
    await module.onInstall?.(nuxtWithVersion('5.0.0'))
    await module.onUpgrade?.(nuxtWithVersion('5.0.0'), {}, '0.3.2')
    expect(info).toHaveBeenCalledTimes(2)
    const message = String(info.mock.calls[0]![0])
    expect(message).toContain('Nuxt 5 checks runtimeConfig schemas itself')
    expect(message).toContain('/guide/nuxt-5')
  })
})
