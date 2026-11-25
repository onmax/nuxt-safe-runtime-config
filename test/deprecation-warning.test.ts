import type { Nuxt } from '@nuxt/schema'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('@nuxt/kit', async importOriginal => ({
  ...await importOriginal<typeof import('@nuxt/kit')>(),
  useLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), success: vi.fn() }),
}))

const rootDir = fileURLToPath(new URL('..', import.meta.url))

function nuxtWithVersion(version: string): Nuxt {
  return { _version: version, options: { rootDir, experimental: {} }, callHook: async () => {}, hook: () => {} } as unknown as Nuxt
}

async function loadModule() {
  vi.resetModules()
  return await import('../src/module')
}

beforeEach(() => {
  warn.mockClear()
})

describe('deprecation warning', () => {
  it.each(['5.0.0', '4.7.1', '4.7.0'])('points Nuxt %s at the migrate command and the post', async (version) => {
    const { default: module, deprecationMessage } = await loadModule()
    await module.onInstall?.(nuxtWithVersion(version))
    expect(warn).toHaveBeenCalledWith(deprecationMessage())
    expect(deprecationMessage()).toBe('nuxt-safe-runtime-config is deprecated: Nuxt 4.7 checks runtimeConfig schemas itself. Run `npx nuxt-safe-runtime-config@latest migrate`. https://nuxt-safe-runtime-config.onmax.me/blog/deprecating-nuxt-safe-runtime-config')
  })

  it.each(['4.7.0-rc.1', '4.7.0-2611241634-21778de', '4.6.4', '3.17.0'])('stays quiet on Nuxt %s, which migrate does not accept', async (version) => {
    const { default: module } = await loadModule()
    await module.onInstall?.(nuxtWithVersion(version))
    await module.onUpgrade?.(nuxtWithVersion(version), {}, '0.4.0')
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns on install and on upgrade', async () => {
    const { default: module } = await loadModule()
    await module.onInstall?.(nuxtWithVersion('4.7.0'))
    await module.onUpgrade?.(nuxtWithVersion('4.7.0'), {}, '0.4.0')
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]![0]).toContain('Run `npx nuxt-safe-runtime-config@latest migrate`.')
  })

  it('still warns a Nuxt 4.7 app set up after an older one in the same process', async () => {
    const { default: module } = await loadModule()
    await module({}, nuxtWithVersion('4.5.0'))
    await module({}, nuxtWithVersion('4.7.0'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns once per process when the module sets up', async () => {
    const { default: module } = await loadModule()
    await module({}, nuxtWithVersion('4.7.0'))
    await module({}, nuxtWithVersion('4.7.0'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not repeat the install warning when setup runs next', async () => {
    const { default: module } = await loadModule()
    await module.onInstall?.(nuxtWithVersion('5.0.0'))
    await module({}, nuxtWithVersion('5.0.0'))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
