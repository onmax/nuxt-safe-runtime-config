// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  // Preserve the existing wrapping style when upgrading the shared config.
  rules: { 'antfu/reasonable-newline': 'off' },
  typescript: true,
  vue: true,
  formatters: true,
  pnpm: true,
  ignores: [
    'docs/**',
    'playground/.env.shelve-demo',
    'playground/shelve.json',
    'src/runtime/**/*.d.ts',
    'src/runtime/**/*.js',
    'test/fixtures/**/.nitro/**',
    'test/fixtures/**/.nuxt/**',
    'test/fixtures/**/.output/**',
  ],
})
