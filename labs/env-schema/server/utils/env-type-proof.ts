import type { useSafeRuntimeConfig } from '#imports'

type Config = ReturnType<typeof useSafeRuntimeConfig>
type Equal<T, U> = (<V>() => V extends T ? 1 : 2) extends (<V>() => V extends U ? 1 : 2) ? true : false
type Assert<T extends true> = T

export type EnvironmentTypeProof = [
  Assert<Equal<Config['roles'], ('read' | 'write')[]>>,
  Assert<Equal<Config['settings'], { enabled: boolean, retries: number, tags: string[] }>>,
  Assert<Equal<Config['metadata'], Record<string, unknown> | undefined>>,
  Assert<Equal<Config['apiSecret'], string>>,
  Assert<Equal<Config['accountPin'], string>>,
  Assert<Equal<Config['retries'], number>>,
  Assert<Equal<Config['optionalLimit'], number | undefined>>,
  Assert<Equal<Config['public']['replayEnabled'], boolean>>,
  Assert<Equal<Config['public']['telemetry']['sampleRate'], number>>,
  Assert<Equal<Config['public']['logLevel'], 'debug' | 'info' | 'warn' | 'error'>>,
  Assert<Equal<Config['public']['apiBase'], string>>,
  Assert<Equal<Extract<keyof Config['public'], 'apiSecret' | 'accountPin' | 'retries' | 'optionalLimit'>, never>>,
]
