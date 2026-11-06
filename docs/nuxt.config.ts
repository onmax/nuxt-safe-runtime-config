export default defineNuxtConfig({
  site: {
    url: 'https://nuxt-safe-runtime-config.onmax.me',
    name: 'Nuxt Safe Runtime Config',
  },
  docus: {
    assistant: { enabled: false },
  },
  routeRules: {
    '/guide/configuration': { redirect: '/reference/configuration' },
    '/schemas': { redirect: '/guide/installation' },
    '/schemas/**': { redirect: '/guide/installation' },
    '/schemas/env-spec': { redirect: '/reference/env-spec' },
    '/integrations': { redirect: '/guide/eslint' },
    '/integrations/eslint': { redirect: '/guide/eslint' },
  },
})
