import { createHash } from 'node:crypto'

export default defineEventHandler((event) => {
  const config = useSafeRuntimeConfig(event)
  const startup = useSafeRuntimeConfig()

  return {
    secretLength: config.apiSecret.length,
    secretDigest: createHash('sha256').update(config.apiSecret).digest('hex'),
    accountPin: config.accountPin,
    retries: config.retries,
    optionalLimit: config.optionalLimit,
    public: config.public,
    types: {
      accountPin: typeof config.accountPin,
      retries: typeof config.retries,
      optionalLimit: typeof config.optionalLimit,
      replayEnabled: typeof config.public.replayEnabled,
      sampleRate: typeof config.public.telemetry.sampleRate,
    },
    matchesStartup: config.apiSecret === startup.apiSecret
      && config.accountPin === startup.accountPin
      && config.retries === startup.retries
      && config.optionalLimit === startup.optionalLimit
      && JSON.stringify(config.public) === JSON.stringify(startup.public),
  }
})
