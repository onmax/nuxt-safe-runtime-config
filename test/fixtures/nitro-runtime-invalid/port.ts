import { defineHandler } from 'nitro/h3'
import { useRuntimeConfig } from 'nitro/runtime-config'

export default defineHandler(() => {
  const { port } = useRuntimeConfig()
  return { port, type: typeof port, typeInPlugin: (globalThis as { portTypeInPlugin?: string }).portTypeInPlugin }
})
