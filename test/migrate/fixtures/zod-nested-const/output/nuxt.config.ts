export default defineNuxtConfig({
  modules: [],
  runtimeConfig: {
    github: {
      owner: process.env.NUXT_GITHUB_OWNER,
      repo: process.env.NUXT_GITHUB_REPO,
      token: process.env.NUXT_GITHUB_TOKEN,
    },
    productionUrl: process.env.NUXT_PRODUCTION_URL,
  },
})
