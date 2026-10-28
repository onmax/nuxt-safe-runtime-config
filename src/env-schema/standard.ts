import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { EnvSchemaObject } from './nuxt'
import { Validator } from '@cfworker/json-schema'
import { envSchemaIssueLocation, normalizeEnvSchemaConfig } from '../runtime/env-schema'

export function createEnvSchemaValidator(jsonSchema: EnvSchemaObject): StandardSchemaV1 {
  const validator = new Validator(jsonSchema, '2020-12')
  return {
    '~standard': {
      version: 1,
      vendor: 'env-spec-v1',
      ...{ jsonSchema: { input: () => jsonSchema, output: () => jsonSchema } },
      validate(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          return { issues: [{ message: 'Runtime config must be an object' }] }
        const value = normalizeEnvSchemaConfig(Object.fromEntries(Object.entries(input)), jsonSchema)
        const result = validator.validate(value)
        return result.valid
          ? { value }
          : { issues: result.errors.map(error => ({ message: `${envSchemaIssueLocation(jsonSchema, error.instanceLocation)}${error.instanceLocation}: ${error.error}` })) }
      },
    },
  }
}
