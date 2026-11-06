import process from 'node:process'
import { defineNuxtConfig } from 'nuxt/config'
import { number, object, optional, string } from 'valibot'

const runtimeConfigSchema = object({
  public: object({
    apiBase: string(),
    appName: optional(string()),
  }),
  databaseUrl: string(),
  secretKey: string(),
  port: optional(number()),

  // shouldThrowError: object({
  //   field: string(),
  // })
})

export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/eslint'],

  eslint: {
    config: {
      standalone: false,
    },
  },

  // Regular runtime config
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb',
    secretKey: process.env.SECRET_KEY || 'default-secret-key',
    port: Number.parseInt(process.env.PORT || '3000'),
    public: {
      apiBase: process.env.PUBLIC_API_BASE || 'https://api.example.com',
      appName: 'My Nuxt App',
    },
  },

  // Schema validation configuration
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },

  devtools: { enabled: true },
})
