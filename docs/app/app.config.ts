export default defineAppConfig({
  header: {
    title: 'Nuxt Safe Runtime Config',
    logo: {
      favicon: '/icon.svg',
    },
  },
  seo: {
    title: 'Nuxt Safe Runtime Config',
    titleTemplate: '%s - Nuxt Safe Runtime Config',
    description: 'nuxt-safe-runtime-config is deprecated. Nuxt 4.7 checks runtimeConfig schemas itself. Migrate with npx nuxt-safe-runtime-config migrate.',
  },
  ui: {
    prose: {
      codeIcon: {
        valibot: 'custom:valibot',
        zod: 'simple-icons:zod',
        arktype: 'custom:arktype',
      },
    },
  },
})
