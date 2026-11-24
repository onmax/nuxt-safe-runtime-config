import { boolean, object, optional, record, string } from 'valibot'

export const runtimeConfigSchema = object({
  sessionSecret: string(),
  seedAuthUsers: boolean(),
  betterAuthSecret: optional(string()),
  ttsVoices: record(string(), string()),
  public: object({
    appName: string(),
    siteUrl: string(),
  }),
})
