import { type } from 'arktype'

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: type({
    apiToken: 'string',
    port: 'number = 3000',
    public: {
      apiBase: 'string.url',
    },
  }),
})
