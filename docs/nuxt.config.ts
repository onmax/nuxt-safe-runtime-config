export default defineNuxtConfig({
  site: {
    url: 'https://nuxt-safe-runtime-config.onmax.me',
    name: 'Nuxt Safe Runtime Config',
  },
  docus: {
    assistant: { enabled: false },
  },
  app: {
    head: {
      // ViteHub Hosted Comments: open a page with ?vitehub to comment. Threads live in the ViteHub Console.
      script: [{
        'type': 'module',
        'src': 'https://console.vitehub.dev/hosted-comments.js',
        'data-vitehub-comments': '8ade2dbb-5d68-45c3-8df2-16618bd90fea',
      }],
    },
  },
  routeRules: {
    '/guide/configuration': { redirect: '/reference/configuration' },
    '/schemas': { redirect: '/guide/installation' },
    '/schemas/**': { redirect: '/guide/installation' },
    '/schemas/env-spec': { redirect: '/reference/env-spec' },
    '/integrations': { redirect: '/guide/eslint' },
    '/integrations/eslint': { redirect: '/guide/eslint' },
    '/guide/nuxt-5': { redirect: '/' },
  },
})
