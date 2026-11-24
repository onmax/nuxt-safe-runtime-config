export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  nitroApp.hooks.hook('request', () => {
    console.log(useRuntimeConfig().apiKey, config.apiKey)
  })
})
