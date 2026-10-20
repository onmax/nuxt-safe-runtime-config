export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig()

  return {
    secret: config.secret,
    perfTraceEnabled: config.perfTrace.enabled,
    posthogEnabled: config.public.posthog.enabled,
    sampleRate: config.public.posthog.sampleRate,
    logins: config.public.logins,
  }
})
