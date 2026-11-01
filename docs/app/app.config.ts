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
    description: 'Validate Nuxt runtime config with Valibot, Zod, ArkType or an annotated .env.example, and read it typed.',
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
