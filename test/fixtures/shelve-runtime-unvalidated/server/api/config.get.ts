export default defineEventHandler(event => ({
  databaseUrl: useRuntimeConfig(event).databaseUrl,
}))
