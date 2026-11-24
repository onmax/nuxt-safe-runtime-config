import { z } from 'zod'

const runtimeConfigSchema = z.object({
  githubAppId: z.union([z.string(), z.number()]).optional(),
  githubWebhookSecret: z.string().min(1, 'NUXT_GITHUB_WEBHOOK_SECRET is required'),
  githubPrivateKey: z.string(),
  model: z.string(),
  maxTokens: z.coerce.number(),
  retry: z.number().catch(3),
}).passthrough()

export default defineNuxtConfig({
  runtimeConfig: runtimeConfigSchema,
})
