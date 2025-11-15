import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('nuxt-safe-runtime-config', () => {
  it('validates successfully with valid hardcoded config', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/validation-success', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)

  it('skips validation when no schema provided', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/no-config', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)

  it('validates after merging .env variables', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/env-var-validation', import.meta.url)),
    })
    expect(true).toBe(true)
  }, 30000)
})
