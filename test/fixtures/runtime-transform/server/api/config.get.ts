import { getValidationRuns } from '../../schema'

export default defineEventHandler(() => {
  const safeConfig = useSafeRuntimeConfig()
  const runtimeConfig = useRuntimeConfig()

  return {
    inputType: safeConfig.inputType,
    safeEnabled: safeConfig.perfTrace.enabled,
    publicEnabled: safeConfig.public.featureEnabled,
    rawPublicType: typeof runtimeConfig.public.featureEnabled,
    validationRuns: getValidationRuns(),
    safeHasApp: 'app' in safeConfig,
    runtimeAppBaseURL: runtimeConfig.app.baseURL,
  }
})
