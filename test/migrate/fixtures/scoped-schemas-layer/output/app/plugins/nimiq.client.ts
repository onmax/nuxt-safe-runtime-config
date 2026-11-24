export default defineNuxtPlugin(() => {
  const config = typeof useRuntimeConfig === 'function' ? useRuntimeConfig() : { public: {} }
  return { provide: { network: config.public } }
})
