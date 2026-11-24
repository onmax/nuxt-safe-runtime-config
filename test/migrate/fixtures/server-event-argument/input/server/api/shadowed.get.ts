export default defineEventHandler((event) => {
  return [1].map((event) => {
    return useSafeRuntimeConfig().apiKey ?? event
  })
})
