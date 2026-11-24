import { runtimeConfigSchema } from './runtime-config.schema'

const isLocalNuxtCommand = process.argv.includes('dev')

export default defineNuxtConfig({
  extends: ['./layers/formula-ui'],
  modules: [
    'nuxt-safe-runtime-config',
    '@nuxt/eslint',
  ],
  nitro: {
    envPrefix: 'NUXT_',
  },
  runtimeConfig: {
    seedAuthUsers: false,
    sessionSecret: '',
    ttsVoices: {
      en: 'alloy',
    },
    public: {
      appName: 'Formula 100',
      siteUrl: '',
    },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
  $env: {
    preview: {
      runtimeConfig: {
        ...(!isLocalNuxtCommand ? { betterAuthSecret: 'preview-secret' } : {}),
      },
    },
  },
})
