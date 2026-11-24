import { useSafeRuntimeConfig } from '#safe-runtime-config/server'

export default defineCachedEventHandler((e) => {
  const read = () => useSafeRuntimeConfig().apiKey
  return { key: read(), again: useSafeRuntimeConfig(e).apiKey }
}, { maxAge: 60 })
