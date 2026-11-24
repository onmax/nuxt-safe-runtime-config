export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey } = useSafeRuntimeConfig()
  return { ok: !!apiKey, body }
})
