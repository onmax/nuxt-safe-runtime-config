import { z } from 'zod'

export const runtimeConfigSchema = z.object({
  public: z.object({
    apiBase: z.string(),
  }),
  secretKey: z.string(),
})
