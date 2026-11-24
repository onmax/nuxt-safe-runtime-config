import { object, optional, string } from 'valibot'

const productionRuntimeConfigSchema = object({
  betterAuthSecret: string(),
  public: object({
    nimiqNetwork: string(),
  }),
})

const developmentRuntimeConfigSchema = object({
  betterAuthSecret: string(),
  public: object({
    nimiqNetwork: string(),
    devToolsUrl: optional(string()),
  }),
})

function readNetwork() {
  return process.env.FIXTURE_UNSET_NETWORK || 'testnet'
}

const sharedRuntimeConfig = {
  betterAuthSecret: '__SET_NUXT_BETTER_AUTH_SECRET__000000',
  public: {
    nimiqNetwork: readNetwork(),
  },
}

export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-safe-runtime-config'],
  runtimeConfig: sharedRuntimeConfig,
  safeRuntimeConfig: {
    $schema: productionRuntimeConfigSchema,
  },
  $development: {
    safeRuntimeConfig: {
      $schema: developmentRuntimeConfigSchema,
    },
  },
  $production: {
    safeRuntimeConfig: {
      $schema: productionRuntimeConfigSchema,
    },
  },
})
