export default defineNuxtPlugin(() => {
  const config = typeof useSafeRuntimeConfig === 'function' ? useSafeRuntimeConfig() : { public: {} }
  return { provide: { network: config.public } }
})
