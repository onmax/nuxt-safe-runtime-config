export default defineEventHandler((event) => {
  const config = useSafeRuntimeConfig(event)
  const sharedConfig = useSafeRuntimeConfig()

  return {
    secret: config.secret,
    perfTraceEnabled: config.perfTrace.enabled,
    posthogEnabled: config.public.posthog.enabled,
    sampleRate: config.public.posthog.sampleRate,
    logins: config.public.logins,
    sameAsShared: config === sharedConfig,
  }
})
