export interface EnvVarLike {
  key: string
  value: string
}

export type ConfigStructure = Record<string, true | Record<string, true>>
export type TransformedConfig = Record<string, string | Record<string, unknown>>

export function toCamelCase(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function getPrefix(key: string): string | null {
  const parts = key.split('_')
  return parts.length > 1 ? parts[0]! : null
}

function countPrefixes(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const prefix = getPrefix(key)
    if (prefix)
      counts.set(prefix, (counts.get(prefix) || 0) + 1)
  }
  return counts
}

function resolveConfigPath(key: string, prefixCounts: Map<string, number>): string[] {
  if (key.startsWith('PUBLIC_'))
    return ['public', toCamelCase(key.slice(7))]

  if (key.startsWith('NUXT_PUBLIC_'))
    return ['public', toCamelCase(key.slice(12))]

  const prefix = getPrefix(key)
  if (prefix && (prefixCounts.get(prefix) || 0) >= 2) {
    return [toCamelCase(prefix), toCamelCase(key.slice(prefix.length + 1))]
  }

  return [toCamelCase(key)]
}

function assignPath<TValue>(target: Record<string, TValue | Record<string, TValue>>, path: string[], value: TValue): void {
  if (path.length === 1) {
    target[path[0]!] = value
    return
  }

  const [head, ...tail] = path
  target[head!] ??= {}
  assignPath(target[head!] as Record<string, TValue | Record<string, TValue>>, tail, value)
}

export function buildConfigStructureFromEnvKeys(keys: string[]): ConfigStructure {
  const result: ConfigStructure = {}
  const prefixCounts = countPrefixes(keys)

  for (const key of keys) {
    const path = resolveConfigPath(key, prefixCounts)
    assignPath(result, path, true)
  }

  return result
}

export function transformEnvVars(vars: readonly EnvVarLike[]): TransformedConfig {
  const result: TransformedConfig = {}
  const prefixCounts = countPrefixes(vars.map(v => v.key))

  for (const { key, value } of vars) {
    const path = resolveConfigPath(key, prefixCounts)
    assignPath(result as Record<string, string | Record<string, string>>, path, value)
  }

  return result
}
