export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { quota: config.quota, apiVersion: config.apiVersion, limits: config.public.limits, unrelatedEnabled: config.unrelatedEnabled }
})
