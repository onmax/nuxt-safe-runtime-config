#!/usr/bin/env node
import process from 'node:process'
import { migrate } from './index'

const usage = `Usage: nuxt-safe-runtime-config migrate [dir] [--dry-run]

Moves safeRuntimeConfig.$schema into Nuxt 4.7 runtimeConfig, renames useSafeRuntimeConfig
to useRuntimeConfig, and removes the module. --dry-run prints the diff and writes nothing.`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === '--help' || command === '-h') {
    console.log(usage)
    return 0
  }
  if (command !== 'migrate') {
    console.error(usage)
    return 1
  }
  const flags = rest.filter(argument => argument.startsWith('-'))
  const unknown = flags.filter(flag => flag !== '--dry-run' && flag !== '--help' && flag !== '-h')
  if (unknown.length || flags.includes('--help') || flags.includes('-h')) {
    ;(unknown.length ? console.error : console.log)(usage)
    return unknown.length ? 1 : 0
  }
  const dirs = rest.filter(argument => !argument.startsWith('-'))
  if (dirs.length > 1) {
    console.error(usage)
    return 1
  }
  const result = await migrate(dirs[0] ?? '.', { dryRun: flags.includes('--dry-run') })
  if (result.status === 'stopped')
    console.error(result.output)
  else
    console.log(result.output)
  return result.status === 'stopped' ? 1 : 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
  },
)
