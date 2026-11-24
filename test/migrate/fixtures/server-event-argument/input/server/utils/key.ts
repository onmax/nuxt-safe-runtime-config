export function apiKey(): string | undefined {
  return useSafeRuntimeConfig().apiKey
}
