export default eventHandler((event) => {
  if (useRuntimeConfig(event).apiKey)
    event.context.keyed = true
})
