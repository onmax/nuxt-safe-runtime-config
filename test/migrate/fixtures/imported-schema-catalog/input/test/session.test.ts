import { expect, it, vi } from 'vitest'

vi.stubGlobal('useSafeRuntimeConfig', () => ({ sessionSecret: 'x' }))

it('reads the secret', () => {
  expect(sessionSecret()).toBe('x')
})
