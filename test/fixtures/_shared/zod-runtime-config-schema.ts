import { z } from 'zod'

export default z.object({
  databaseUrl: z.url(),
  port: z.number().int().default(3000),
})
