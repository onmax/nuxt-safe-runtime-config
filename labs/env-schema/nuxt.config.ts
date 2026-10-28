import { defineNuxtConfig } from 'nuxt/config'
import SafeRuntimeConfig from '../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  devtools: { enabled: false },
  safeRuntimeConfig: {
    envSchema: {
      file: '.env.example',
      paths: {
        NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE: 'public.telemetry.sampleRate',
      },
    },
  },
})
