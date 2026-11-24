import { expect, it, vi } from 'vitest'

vi.stubGlobal('useRuntimeConfig', () => ({ sessionSecret: 'x' }))

it('reads the secret', () => {
  expect(sessionSecret()).toBe('x')
})
