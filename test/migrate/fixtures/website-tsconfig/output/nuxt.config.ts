export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxtjs/seo'],
  runtimeConfig: {
    public: {
      siteUrl: 'https://example.com',
    },
  },
  typescript: {
    sharedTsConfig: {
      include: [
        './content/types.d.ts',
      ],
    },
  },
  studio: {
    // @ts-expect-error the studio module types lag behind
    auth: { github: true },
  },
  // doctor-disable-next-line
  compatibilityDate: '2025-07-15',
})
