import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'

// Test files run in parallel next to @nuxt/test-utils servers on random ports, so a fixed port can already be taken.
export function getFreePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(String(port)))
    })
  })
}
