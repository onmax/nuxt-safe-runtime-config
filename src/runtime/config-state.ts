type RuntimeConfig = Record<string, unknown>

export type RuntimeValidationState =
  | { status: 'pending', ready: Promise<void> }
  | { status: 'valid', value: RuntimeConfig }
  | { status: 'invalid' }
  | { status: 'failed', error: unknown }

interface RuntimeValidationStore {
  latest?: RuntimeValidationState
  states: WeakMap<RuntimeConfig, RuntimeValidationState>
}

const validationStoreKey = Symbol.for('nuxt-safe-runtime-config.validation-store')
const existingValidationStore = Reflect.get(globalThis, validationStoreKey) as RuntimeValidationStore | undefined
const validationStore = existingValidationStore ?? { states: new WeakMap<RuntimeConfig, RuntimeValidationState>() }
if (!existingValidationStore)
  Reflect.set(globalThis, validationStoreKey, validationStore)

export function getRuntimeValidationState(config: RuntimeConfig): RuntimeValidationState | undefined {
  return validationStore.states.get(config) ?? validationStore.latest
}

export function setRuntimeValidationState(config: RuntimeConfig, state: RuntimeValidationState): void {
  validationStore.states.set(config, state)
  validationStore.latest = state
}

export function applyValidatedRuntimeConfig(config: RuntimeConfig, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Runtime config schema output must be an object')

  const output = value as RuntimeConfig
  for (const [key, transformedValue] of Object.entries(output)) {
    if (Object.hasOwn(config, key))
      Reflect.set(config, key, transformedValue)
  }
  setRuntimeValidationState(config, { status: 'valid', value: output })
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
