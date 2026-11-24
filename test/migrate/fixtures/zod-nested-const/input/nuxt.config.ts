import { z } from 'zod'

const linearWorkspaceSchema = z.object({
  apiKey: z.string(),
  teamId: z.string(),
})

const runtimeConfigSchema = z.object({
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    token: z.string(),
  }),
  linearWorkspaces: z.record(z.string(), linearWorkspaceSchema).optional(),
  productionUrl: z.string(),
})

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    github: {
      owner: process.env.NUXT_GITHUB_OWNER,
      repo: process.env.NUXT_GITHUB_REPO,
      token: process.env.NUXT_GITHUB_TOKEN,
    },
    productionUrl: process.env.NUXT_PRODUCTION_URL,
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
