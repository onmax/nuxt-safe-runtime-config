export default defineEventHandler((event) => {
  const config = useSafeRuntimeConfig(event)

  return {
    databaseUrl: config.databaseUrl,
    github: config.github,
    startupDatabaseUrl: useSafeRuntimeConfig().databaseUrl,
    // The secrets are merged into Nitro 2's per-request config too.
    rawDatabaseUrl: useRuntimeConfig(event).databaseUrl,
  }
})
