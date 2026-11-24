import { useRuntimeConfig, useSafeRuntimeConfig } from '#imports'

export function rpcUrl() {
  return useSafeRuntimeConfig().albatrossRpcNodeUrl || useRuntimeConfig().public.gitBranch
}
