import safeRuntimeConfig from 'nuxt-safe-runtime-config/eslint'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(safeRuntimeConfig.configs.recommended)
