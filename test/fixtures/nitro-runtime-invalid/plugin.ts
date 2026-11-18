import { useRuntimeConfig } from 'nitro/runtime-config'

// What a user's plugin sees: the validated config only if the module's plugin ran first.
export default (): void => {
  (globalThis as { portTypeInPlugin?: string }).portTypeInPlugin = typeof useRuntimeConfig().port
}
