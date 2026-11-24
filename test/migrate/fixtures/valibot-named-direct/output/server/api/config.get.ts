export default defineEventHandler(() => {
  const { port } = useRuntimeConfig()
  return { port }
})
