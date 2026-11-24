import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = { public: { nimiqNetwork: 'testnet' } }

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => config)
  ;(globalThis as any).useRuntimeConfig = () => config
})

describe('network', () => {
  it('reads the network', () => {
    expect(useRuntimeConfig().public.nimiqNetwork).toBe('testnet')
  })
})
