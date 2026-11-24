import { expect, it, vi } from 'vitest'

it('reads the rpc url', () => {
  vi.stubGlobal('useSafeRuntimeConfig', () => ({ albatrossRpcNodeUrl: 'http://rpc' }))
  expect(rpcUrl()).toBe('http://rpc')
})
