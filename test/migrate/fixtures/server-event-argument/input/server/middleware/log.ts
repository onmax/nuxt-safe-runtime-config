export default eventHandler((event) => {
  if (useSafeRuntimeConfig().apiKey)
    event.context.keyed = true
})
