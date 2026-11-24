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
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    githubAppId: '',
    githubWebhookSecret: '',
    githubPrivateKey: '',
    model: 'gpt-5',
    maxTokens: 4096,
    retry: 3,
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtBuild: false,
    validateAtRuntime: false,
    onError: 'warn',
    jsonSchemaTarget: 'draft-07',
  },
})
