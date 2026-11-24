import type { H3Event } from 'h3'

export function cubeToken(event: H3Event) {
  const config = useRuntimeConfig(event) as ReturnType<typeof useRuntimeConfig>
  const flags = useRuntimeConfig(event).public.featureFlags // eslint-disable-line no-console
  return { secret: config.betterAuthSecret, flags }
}
