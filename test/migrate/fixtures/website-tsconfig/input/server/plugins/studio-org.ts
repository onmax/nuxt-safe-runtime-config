export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    // eslint-disable-next-line safe-runtime-config/prefer-safe-runtime-config
    const config = useRuntimeConfig(event)
    event.context.productlane = config.productlaneApiKey
  })
})
