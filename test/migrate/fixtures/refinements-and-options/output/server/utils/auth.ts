type RuntimeConfig = ReturnType<typeof useRuntimeConfig>
type PublicConfig = Pick<ReturnType<typeof useRuntimeConfig>['public'], 'siteUrl'>

export function authOptions(config: RuntimeConfig = useRuntimeConfig()): PublicConfig & { secret: string } {
  return { secret: config.betterAuthSecret, siteUrl: config.public.siteUrl }
}
