import { fileURLToPath } from 'node:url'
import { buildFixture, createTest, createTestContext, loadFixture, useTestContext } from '@nuxt/test-utils'
import { describe, expect, it } from 'vitest'

describe('nuxt-safe-runtime-config module', () => {
  it('should successfully build with valid runtime config', async () => {
    createTest({
      rootDir: fileURLToPath(new URL('./fixtures/validation-success', import.meta.url)),
      dev: false,
      server: false,
    })
    await loadFixture()
    await buildFixture()
    const nuxt = useTestContext().nuxt!
    expect(nuxt.options.runtimeConfig.public.apiBase).toBe('https://api.test.com')
  }, 20000)

  it('should fail to build with invalid runtime config', async () => {
    createTestContext({
      rootDir: fileURLToPath(new URL('./fixtures/validation-failure', import.meta.url)),
      dev: false,
      server: false,
    })
    await loadFixture()
    await expect(buildFixture()).rejects.toThrowError()
  }, 20000)

  it('should successfully build when module is included but no safeRuntimeConfig is provided', async () => {
    createTest({
      rootDir: fileURLToPath(new URL('./fixtures/no-config', import.meta.url)),
      dev: false,
      server: false,
    })
    await loadFixture()
    await buildFixture()
    const nuxt = useTestContext().nuxt!
    expect(nuxt.options.runtimeConfig.public.apiBase).toBe('https://api.test.com')
  }, 20000)
})
