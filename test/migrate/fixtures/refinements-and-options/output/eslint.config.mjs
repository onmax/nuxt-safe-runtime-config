import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  files: ['server/**'],
  rules: {
    'no-console': 'off',
  },
})
