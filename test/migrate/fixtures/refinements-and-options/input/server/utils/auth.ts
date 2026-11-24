type RuntimeConfig = ReturnType<typeof useSafeRuntimeConfig>
type PublicConfig = Pick<ReturnType<typeof useSafeRuntimeConfig>['public'], 'siteUrl'>

export function authOptions(config: RuntimeConfig = useSafeRuntimeConfig()): PublicConfig & { secret: string } {
  return { secret: config.betterAuthSecret, siteUrl: config.public.siteUrl }
}
