export default defineEventHandler({
  onRequest: [],
  handler(event) {
    return useSafeRuntimeConfig().apiKey
  },
})
