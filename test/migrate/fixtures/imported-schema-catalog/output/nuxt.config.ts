const isLocalNuxtCommand = process.argv.includes('dev')

export default defineNuxtConfig({
  extends: ['./layers/formula-ui'],
  modules: [
    '@nuxt/eslint',
  ],
  nitro: {
    envPrefix: 'NUXT_',
  },
  runtimeConfig: {
    seedAuthUsers: false,
    ttsVoices: {
      en: 'alloy',
    },
    public: {
      appName: 'Formula 100',
    },
  },
  $env: {
    preview: {
      runtimeConfig: {
        ...(!isLocalNuxtCommand ? { betterAuthSecret: 'preview-secret' } : {}),
      },
    },
  },
})
