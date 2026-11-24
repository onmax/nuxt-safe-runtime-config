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
  runtimeConfig: runtimeConfigSchema,
})
