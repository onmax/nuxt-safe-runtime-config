import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { toJsonSchema } from '@standard-community/standard-json'
import { errorMessage } from './error'

type NativeJsonSchemaOutput = (options: {
  target: StandardJSONSchemaV1.Target
}) => Record<string, unknown> | Promise<Record<string, unknown>>

interface StandardSchemaWithNativeJsonSchema extends StandardSchemaV1 {
  '~standard': StandardSchemaV1['~standard'] & {
    jsonSchema?: {
      output?: NativeJsonSchemaOutput
    }
  }
}

function getNativeJSONSchemaOutput(schema: StandardSchemaV1): NativeJsonSchemaOutput | undefined {
  const output = (schema as StandardSchemaWithNativeJsonSchema)['~standard']?.jsonSchema?.output
  return typeof output === 'function' ? output : undefined
}

export function hasNativeJSONSchema(schema: StandardSchemaV1): boolean {
  return Boolean(getNativeJSONSchemaOutput(schema))
}

export async function getJSONSchema(
  schema: StandardSchemaV1,
  target: StandardJSONSchemaV1.Target = 'draft-2020-12',
  onFallback?: (message: string) => void,
): Promise<Record<string, unknown>> {
  const nativeOutput = getNativeJSONSchemaOutput(schema)

  if (nativeOutput) {
    try {
      return await nativeOutput({ target })
    }
    catch (error) {
      onFallback?.(`Native JSON Schema failed for target "${target}" (${errorMessage(error)}), using @standard-community/standard-json fallback`)
    }
  }

  return await toJsonSchema(schema) as Record<string, unknown>
}
