import preferSafeRuntimeConfig from './rules/prefer-safe-runtime-config'

const plugin = {
  meta: { name: 'nuxt-safe-runtime-config' },
  rules: { 'prefer-safe-runtime-config': preferSafeRuntimeConfig },
}

export const configs = {
  recommended: {
    plugins: { 'safe-runtime-config': plugin },
    rules: { 'safe-runtime-config/prefer-safe-runtime-config': 'warn' },
  },
}

// Default export with configs for @nuxt/eslint integration
export default { ...plugin, configs }
