import { useRuntimeConfig } from '#imports'

export function rpcUrl() {
  return useRuntimeConfig().albatrossRpcNodeUrl || useRuntimeConfig().public.gitBranch
}
