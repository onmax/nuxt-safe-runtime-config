export default defineEventHandler({
  onRequest: [],
  handler(event) {
    return useRuntimeConfig(event).apiKey
  },
})
