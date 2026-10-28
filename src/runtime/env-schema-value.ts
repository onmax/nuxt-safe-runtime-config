export type EnvSchemaValue = string | number | boolean | null | EnvSchemaValue[] | { [key: string]: EnvSchemaValue }

/** JSON values accepted at the environment boundary, without prototype or internal keys. */
export function isEnvSchemaValue(value: unknown, depth = 0): value is EnvSchemaValue {
  if (depth > 64)
    return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every(item => isEnvSchemaValue(item, depth + 1))
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return false
  return Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor', '__envSchemaUnset'].includes(key) && isEnvSchemaValue(item, depth + 1))
}
