export default defineEventHandler((event) => {
  return [1].map((event) => {
    return useRuntimeConfig().apiKey ?? event
  })
})
