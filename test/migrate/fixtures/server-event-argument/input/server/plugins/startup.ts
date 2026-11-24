export default defineNitroPlugin((nitroApp) => {
  const config = useSafeRuntimeConfig()
  nitroApp.hooks.hook('request', () => {
    console.log(useSafeRuntimeConfig().apiKey, config.apiKey)
  })
})
