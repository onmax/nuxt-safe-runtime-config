type RuntimeConfig = Record<string, unknown>

export const runtimeValidationContextKey = Symbol.for('nuxt-safe-runtime-config.validation-context')

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function mergeTransformedRuntimeConfig(current: unknown, transformed: unknown): unknown {
  if (!isRuntimeConfig(current) || !isRuntimeConfig(transformed))
    return transformed

  const merged: RuntimeConfig = { ...current }
  for (const [key, value] of Object.entries(transformed))
    merged[key] = mergeTransformedRuntimeConfig(current[key], value)
  return merged
}

export type RuntimeValidationState =
  | { status: 'pending', ready: Promise<void> }
  | { status: 'valid', value: RuntimeConfig }
  | { status: 'invalid' }
  | { status: 'failed', error: unknown }

interface RuntimeValidationStore {
  states: WeakMap<RuntimeConfig, RuntimeValidationState>
}

const validationStoreKey = Symbol.for('nuxt-safe-runtime-config.validation-store')
const existingValidationStore = Reflect.get(globalThis, validationStoreKey) as RuntimeValidationStore | undefined
const validationStore = existingValidationStore ?? { states: new WeakMap<RuntimeConfig, RuntimeValidationState>() }
if (!existingValidationStore)
  Reflect.set(globalThis, validationStoreKey, validationStore)

export function getRuntimeValidationState(config: RuntimeConfig): RuntimeValidationState | undefined {
  return validationStore.states.get(config)
}

export function setRuntimeValidationState(config: RuntimeConfig, state: RuntimeValidationState): void {
  validationStore.states.set(config, state)
}

export function applyValidatedRuntimeConfig(config: RuntimeConfig, value: unknown): void {
  if (!isRuntimeConfig(value))
    throw new TypeError('Runtime config schema output must be an object')

  for (const [key, transformedValue] of Object.entries(value)) {
    if (Object.hasOwn(config, key))
      Reflect.set(config, key, mergeTransformedRuntimeConfig(config[key], transformedValue))
  }
  setRuntimeValidationState(config, { status: 'valid', value })
}

export function useValidatedRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  const state = getRuntimeValidationState(config)
  if (!state || state.status === 'invalid')
    return config
  if (state.status === 'valid')
    return state.value
  if (state.status === 'failed')
    throw state.error
  throw new Error('Runtime config validation is still pending')
}

export async function waitForRuntimeConfigValidation(config: RuntimeConfig): Promise<void> {
  const state = getRuntimeValidationState(config)
  if (state?.status === 'pending')
    await state.ready

  const settledState = getRuntimeValidationState(config)
  if (settledState?.status === 'failed')
    throw settledState.error
}
