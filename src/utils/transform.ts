import type { EnvVar, TransformedConfig } from '../types'
import type { ConfigStructure as ConfigStructureShared } from './transform-shared'
import {
  buildConfigStructureFromEnvKeys as buildConfigStructureFromEnvKeysShared,
  getPrefix as getPrefixShared,
  toCamelCase as toCamelCaseShared,
  transformEnvVarsInternal,
} from './transform-shared'

export type ConfigStructure = ConfigStructureShared

export function toCamelCase(str: string): string {
  return toCamelCaseShared(str)
}

export function getPrefix(key: string): string | null {
  return getPrefixShared(key)
}

export function buildConfigStructureFromEnvKeys(keys: string[]): ConfigStructure {
  return buildConfigStructureFromEnvKeysShared(keys)
}

export function transformEnvVars(vars: EnvVar[]): TransformedConfig {
  return transformEnvVarsInternal(vars) as TransformedConfig
}
