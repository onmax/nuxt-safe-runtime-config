import process from 'node:process'

const lessons = [{ title: 'Lesson 1' }]

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: {
    sessionSecret: process.env.FIXTURE_SESSION_SECRET,
    apiKey: process.env.FIXTURE_API_KEY || '',
    github: {
      clientId: process.env.FIXTURE_GITHUB_CLIENT_ID,
    },
    public: {
      lessons,
      region: 'moon',
      siteName: 'Lingo',
    },
  },
})
