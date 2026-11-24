import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = { public: { nimiqNetwork: 'testnet' } }

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('useSafeRuntimeConfig', () => config)
  ;(globalThis as any).useSafeRuntimeConfig = () => config
})

describe('network', () => {
  it('reads the network', () => {
    expect(useSafeRuntimeConfig().public.nimiqNetwork).toBe('testnet')
  })
})
