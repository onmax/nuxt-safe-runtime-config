import type { EnvVar, TransformedConfig } from '../types'
import {
  getPrefix as getPrefixShared,
  toCamelCase as toCamelCaseShared,
  transformEnvVarsInternal,
} from './transform-shared'

export function toCamelCase(str: string): string {
  return toCamelCaseShared(str)
}

export function getPrefix(key: string): string | null {
  return getPrefixShared(key)
}

export function transformEnvVars(vars: EnvVar[]): TransformedConfig {
  return transformEnvVarsInternal(vars) as TransformedConfig
}
