export default defineEventHandler(() => {
  const config = useSafeRuntimeConfig() as any
  return { ok: true, apiBase: config.public.apiBase }
})
