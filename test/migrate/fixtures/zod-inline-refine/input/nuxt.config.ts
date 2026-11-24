import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', 'nuxt-safe-runtime-config'],
  runtimeConfig: {
    albatrossRpcNodeUrl: '',
    slackWebhookUrl: process.env.FIXTURE_UNSET_SLACK_WEBHOOK_URL || '',
    syncMode: 'off',
    public: {
      gitBranch: 'main',
    },
  },
  safeRuntimeConfig: {
    $schema: z.object({
      albatrossRpcNodeUrl: z.string().describe('NUXT_ALBATROSS_RPC_NODE_URL is required'),
      slackWebhookUrl: z.string().refine(value => !value || value.startsWith('https://'), { message: 'must be https' }),
      syncMode: z.enum(['off', 'daily']).default('off'),
      public: z.object({
        gitBranch: z.string(),
      }),
    }),
  },
})
