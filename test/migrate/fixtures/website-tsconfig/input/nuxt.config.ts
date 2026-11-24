import { object, string } from 'valibot'

const runtimeConfigSchema = object({ productlaneApiKey: string() })

export default defineNuxtConfig({
  modules: ['@nuxt/content', 'nuxt-safe-runtime-config', '@nuxtjs/seo'],
  runtimeConfig: {
    productlaneApiKey: '',
    public: {
      siteUrl: 'https://example.com',
    },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtBuild: true,
    validateAtRuntime: true,
    requireAtBuild: true,
    onError: 'throw',
  },
  typescript: {
    sharedTsConfig: {
      include: [
        // The module writes its types under .nuxt, so list them for the shared project.
        './types/safe-runtime-config.d.ts',
        './content/types.d.ts',
      ],
    },
    nodeTsConfig: {
      include: ['./types/safe-runtime-config.d.ts'],
    },
  },
  studio: {
    // @ts-expect-error the studio module types lag behind
    auth: { github: true },
  },
  // doctor-disable-next-line
  compatibilityDate: '2025-07-15',
})
