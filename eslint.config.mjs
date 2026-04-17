// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
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
  ],
})
