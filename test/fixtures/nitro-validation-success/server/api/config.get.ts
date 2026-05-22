export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { port: config.port }
})
