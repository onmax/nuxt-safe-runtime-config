export default defineEventHandler((event) => {
  const config = useSafeRuntimeConfig(event)

  return {
    secret: config.secret,
    perfTraceEnabled: config.perfTrace.enabled,
    posthogEnabled: config.public.posthog.enabled,
    sampleRate: config.public.posthog.sampleRate,
    logins: config.public.logins,
    matchesStartup: JSON.stringify(config) === JSON.stringify(useSafeRuntimeConfig()),
    // Validated values are written back into Nitro 2's per-request config.
    rawEventType: typeof useRuntimeConfig(event).public.posthog.enabled,
  }
})
