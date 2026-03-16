export default defineAppConfig({
  docus: {
    title: 'Nuxt Safe Runtime Config',
    description: 'Validate Nuxt runtime config at build or runtime using Zod, Valibot, ArkType, or any Standard Schema compatible library.',
    url: 'https://nuxt-safe-runtime-config.onmax.me',
    github: 'onmax/nuxt-safe-runtime-config',
    themeColor: 'green',
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
