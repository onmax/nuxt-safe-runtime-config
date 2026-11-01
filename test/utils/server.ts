import type { spawn } from 'node:child_process'

export async function waitForResponse(url: string, child: ReturnType<typeof spawn>): Promise<Response> {
  let logs = ''
  child.stdout?.on('data', chunk => logs += chunk.toString())
  child.stderr?.on('data', chunk => logs += chunk.toString())

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return response
    }
    catch {}
    if (child.exitCode !== null)
      throw new Error(`Server exited with code ${child.exitCode}\n${logs}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Server did not respond at ${url}\n${logs}`)
}
