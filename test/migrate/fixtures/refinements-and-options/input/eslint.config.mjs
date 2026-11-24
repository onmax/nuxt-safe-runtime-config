import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'safe-runtime-config/prefer-safe-runtime-config': 'error',
  },
}, {
  files: ['server/**'],
  rules: {
    'no-console': 'off',
    'safe-runtime-config/prefer-safe-runtime-config': 'error',
  },
})
