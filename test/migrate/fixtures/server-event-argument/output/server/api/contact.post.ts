export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey } = useRuntimeConfig(event)
  return { ok: !!apiKey, body }
})
