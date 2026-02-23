import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { describe, it } from 'vitest'

describe('shelve integration', () => {
  it('does not enable Shelve when not configured', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/shelve-integration', import.meta.url)),
    })
  }, 30000)

  it('does not enable Shelve when explicitly disabled', async () => {
    await setup({
      rootDir: fileURLToPath(new URL('./fixtures/no-config', import.meta.url)),
    })
  }, 30000)
})
