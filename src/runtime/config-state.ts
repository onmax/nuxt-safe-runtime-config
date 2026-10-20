type RuntimeConfig = Record<string, unknown>

/**
 * Validates one runtime config object and records the outcome with `setRuntimeValidationState`.
 * Asynchronous schemas record a `pending` state whose promise never rejects.
 */
export type RuntimeConfigValidator = (config: RuntimeConfig) => void

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
  validator?: RuntimeConfigValidator
  /** The startup config and its serialized raw values, reused for event configs with equal values. */
  baseline?: { config: RuntimeConfig, snapshot: string }
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

/**
 * Registers the validator and validates the startup config with it.
 * Event-scoped configs are validated later through `ensureRuntimeConfigValidation`.
 */
export function registerRuntimeConfigValidator(validator: RuntimeConfigValidator, config: RuntimeConfig): void {
  validationStore.validator = validator
  validationStore.baseline = { config, snapshot: JSON.stringify(config) }
  validator(config)
}

// Event configs must not share mutable objects with other requests.
function clonePlain<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(clonePlain) as T
  if (isRuntimeConfig(value) && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)])) as T
  return value
}

/**
 * Validates a config object once and writes the validated values into it when it is mutable.
 * Event configs whose raw values equal the startup config reuse a copy of its outcome, so Node
 * servers run the schema once per process.
 */
export function ensureRuntimeConfigValidation(config: RuntimeConfig): void | Promise<void> {
  const state = getRuntimeValidationState(config)
  if (state)
    return state.status === 'pending' ? state.ready : undefined

  const { validator, baseline } = validationStore
  if (!validator || !baseline)
    return

  if (JSON.stringify(config) === baseline.snapshot) {
    const baselineState = getRuntimeValidationState(baseline.config)
    if (baselineState?.status === 'pending')
      return baselineState.ready.then(() => ensureRuntimeConfigValidation(config))
    if (baselineState?.status === 'valid') {
      applyValidatedRuntimeConfig(config, clonePlain(baselineState.value))
      return
    }
    if (baselineState) {
      setRuntimeValidationState(config, baselineState)
      return
    }
  }

  validator(config)
  const validatedState = getRuntimeValidationState(config)
  return validatedState?.status === 'pending' ? validatedState.ready : undefined
}

export async function waitForRuntimeConfigValidation(config: RuntimeConfig): Promise<void> {
  await ensureRuntimeConfigValidation(config)

  const settledState = getRuntimeValidationState(config)
  if (settledState?.status === 'failed')
    throw settledState.error
}
