// @ts-check
import antfu from '@antfu/eslint-config'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  antfu({
    typescript: true,
    vue: true,
    formatters: true,
    rules: {
      'no-console': 'off', // Allow console.log in development
    },
  }),
)
