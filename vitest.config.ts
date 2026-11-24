import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/migrate/fixtures/**', 'test/migrate/.tmp/**'],
  },
})
