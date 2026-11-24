export default defineCachedEventHandler((e) => {
  const read = () => useRuntimeConfig(e).apiKey
  return { key: read(), again: useRuntimeConfig(e).apiKey }
}, { maxAge: 60 })
