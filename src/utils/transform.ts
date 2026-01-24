import type { EnvVar, TransformedConfig } from '../types'

export function toCamelCase(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function getPrefix(key: string): string | null {
  const parts = key.split('_')
  return parts.length > 1 ? parts[0]! : null
}

function countPrefixes(vars: EnvVar[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { key } of vars) {
    const prefix = getPrefix(key)
    if (prefix)
      counts.set(prefix, (counts.get(prefix) || 0) + 1)
  }
  return counts
}

/** Transforms EnvVar[] to camelCase runtimeConfig. Groups repeated prefixes (2+ keys) and routes PUBLIC_* / NUXT_PUBLIC_* to public namespace */
export function transformEnvVars(vars: EnvVar[]): TransformedConfig {
  const prefixCounts = countPrefixes(vars)
  const result: TransformedConfig = {}

  for (const { key, value } of vars) {
    if (key.startsWith('PUBLIC_')) {
      result.public ??= {}
      assignNested(result.public as Record<string, unknown>, key.slice(7), value, prefixCounts)
      continue
    }
    if (key.startsWith('NUXT_PUBLIC_')) {
      result.public ??= {}
      assignNested(result.public as Record<string, unknown>, key.slice(12), value, prefixCounts)
      continue
    }

    const prefix = getPrefix(key)
    if (prefix && (prefixCounts.get(prefix) || 0) >= 2) {
      const groupKey = toCamelCase(prefix)
      result[groupKey] ??= {}
      const nestedKey = toCamelCase(key.slice(prefix.length + 1))
        ; (result[groupKey] as Record<string, unknown>)[nestedKey] = value
    }
    else {
      result[toCamelCase(key)] = value
    }
  }

  return result
}

/** Applies same grouping rules to PUBLIC_* vars within the public namespace */
function assignNested(obj: Record<string, unknown>, key: string, value: string, prefixCounts: Map<string, number>): void {
  const prefix = getPrefix(key)
  if (prefix && (prefixCounts.get(`PUBLIC_${prefix}`) || prefixCounts.get(`NUXT_PUBLIC_${prefix}`) || 0) >= 2) {
    const groupKey = toCamelCase(prefix)
    obj[groupKey] ??= {}
    const rest = key.slice(prefix.length + 1)
    const nestedKey = toCamelCase(rest)
      ; (obj[groupKey] as Record<string, unknown>)[nestedKey] = value
  }
  else {
    obj[toCamelCase(key)] = value
  }
}
