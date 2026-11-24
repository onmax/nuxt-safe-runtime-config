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
  modules: ['@nuxt/ui'],
  runtimeConfig: sharedRuntimeConfig,
})
