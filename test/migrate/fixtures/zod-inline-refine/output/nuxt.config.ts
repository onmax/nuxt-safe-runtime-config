export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  runtimeConfig: {
    slackWebhookUrl: process.env.FIXTURE_UNSET_SLACK_WEBHOOK_URL || '',
    syncMode: 'off',
    public: {
      gitBranch: 'main',
    },
  },
})
