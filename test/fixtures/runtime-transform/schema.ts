import * as v from 'valibot'

const validationRunsKey = Symbol.for('nuxt-safe-runtime-config.test.validation-runs')

const inputSchema = v.object({
  perfTrace: v.object({
    enabled: v.union([v.boolean(), v.string()]),
  }),
  public: v.object({
    featureEnabled: v.union([v.boolean(), v.string()]),
  }),
})

const outputSchema = v.object({
  inputType: v.literal('string'),
  perfTrace: v.object({
    enabled: v.boolean(),
  }),
  public: v.object({
    featureEnabled: v.boolean(),
  }),
  validationRuns: v.number(),
})

export function getValidationRuns(): number {
  return (Reflect.get(globalThis, validationRunsKey) as number | undefined) ?? 0
}

export default v.pipeAsync(
  inputSchema,
  v.transformAsync(async (config) => {
    const validationRuns = getValidationRuns() + 1
    Reflect.set(globalThis, validationRunsKey, validationRuns)
    await new Promise(resolve => setTimeout(resolve, 25))
    return {
      inputType: typeof config.perfTrace.enabled,
      perfTrace: { enabled: config.perfTrace.enabled === true || config.perfTrace.enabled === 'true' },
      public: { featureEnabled: config.public.featureEnabled === true || config.public.featureEnabled === 'true' },
      validationRuns,
    }
  }),
  outputSchema,
)
