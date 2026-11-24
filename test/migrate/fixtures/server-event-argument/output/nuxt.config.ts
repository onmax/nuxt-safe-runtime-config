import { z } from 'zod'

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: z.object({
    apiKey: z.string().optional(),
  }),
})
