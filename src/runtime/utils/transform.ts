import { transformEnvVarsInternal } from '../../utils/transform-shared'

interface EnvVar { key: string, value: string }
type TransformedConfig = Record<string, string | Record<string, unknown>>

export function transformEnvVars(vars: EnvVar[]): TransformedConfig {
  return transformEnvVarsInternal(vars) as TransformedConfig
}
