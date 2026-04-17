import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { toJsonSchema } from '@standard-community/standard-json'

export function hasNativeJSONSchema(schema: StandardSchemaV1): boolean {
  return typeof (schema?.['~standard'] as any)?.jsonSchema?.output === 'function'
}

export async function getJSONSchema(
  schema: StandardSchemaV1,
  target: StandardJSONSchemaV1.Target = 'draft-2020-12',
  onFallback?: (message: string) => void,
): Promise<Record<string, unknown>> {
  if (hasNativeJSONSchema(schema)) {
    try {
      return (schema['~standard'] as any).jsonSchema.output({ target })
    }
    catch {
      onFallback?.(`Native JSON Schema failed for target "${target}", using fallback`)
    }
  }
  else {
    onFallback?.('Schema does not support native JSON Schema, using @standard-community/standard-json fallback')
  }

  return await toJsonSchema(schema as any) as Record<string, unknown>
}
