import { validateRuntimeConfig } from 'nuxt-safe-runtime-config/nitro'

export default defineNitroPlugin(() => {
  validateRuntimeConfig()
})
