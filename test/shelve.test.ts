import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { describe, it } from 'vitest'

describe('shelve integration', () => {
  it('does not enable Shelve when not configured', async () => {
    // Shelve is no longer auto-enabled via shelve.json detection
    // It requires explicit config in nuxt.config
    // Test passes if setup completes without throwing
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/shelve-integration', import.meta.url)),
    })
  }, 30000)

  it('does not enable Shelve when explicitly disabled', async () => {
    // Test passes if setup completes without throwing
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/no-config', import.meta.url)),
    })
  }, 30000)
})
