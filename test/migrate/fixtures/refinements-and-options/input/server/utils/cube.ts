import type { H3Event } from 'h3'

export function cubeToken(event: H3Event) {
  // eslint-disable-next-line safe-runtime-config/prefer-safe-runtime-config -- the event-scoped config carries tenant overrides
  const config = useRuntimeConfig(event) as ReturnType<typeof useSafeRuntimeConfig>
  const flags = useRuntimeConfig(event).public.featureFlags // eslint-disable-line safe-runtime-config/prefer-safe-runtime-config, no-console
  return { secret: config.betterAuthSecret, flags }
}
