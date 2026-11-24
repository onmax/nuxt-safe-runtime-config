export default defineEventHandler(() => {
  const { port } = useSafeRuntimeConfig()
  return { port }
})
