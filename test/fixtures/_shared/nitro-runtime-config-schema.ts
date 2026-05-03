import { number, object, string } from 'valibot'

export const runtimeConfigSchema = object({
  port: number(),
  secretKey: string(),
  public: object({ apiBase: string() }),
})

export const validRuntimeConfig = {
  port: 3000,
  secretKey: 'test-secret',
  public: { apiBase: 'https://api.example.com' },
}

export const invalidRuntimeConfig = {
  ...validRuntimeConfig,
  port: 'not-a-number',
}
