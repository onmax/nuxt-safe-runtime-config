import { z } from 'zod'

export default z.object({
  databaseUrl: z.string(),
  port: z.number().int().default(3000),
  public: z.object({
    apiBase: z.string().url().default('https://api.example.com'),
  }),
})
