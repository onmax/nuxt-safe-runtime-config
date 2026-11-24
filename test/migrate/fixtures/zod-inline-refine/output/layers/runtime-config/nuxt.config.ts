import { z } from 'zod'

export default defineNuxtConfig({
  runtimeConfig: z.object({
    albatrossRpcNodeUrl: z.string().describe('NUXT_ALBATROSS_RPC_NODE_URL is required'),
    slackWebhookUrl: z.string().refine(value => !value || value.startsWith('https://'), { message: 'must be https' }),
    syncMode: z.enum(['off', 'daily']).default('off'),
    public: z.object({
      gitBranch: z.string(),
    }),
  }),
})
