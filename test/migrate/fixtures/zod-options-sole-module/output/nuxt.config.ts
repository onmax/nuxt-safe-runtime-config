export default defineNuxtConfig({
  modules: [],
  runtimeConfig: {
    githubAppId: '',
    model: 'gpt-5',
    maxTokens: 4096,
    retry: 3,
  },
})
