/// <reference path="../../runtime-nitro.d.ts" />
import process from 'node:process'
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { shelveRuntimeConfig } from '#safe-runtime-config/shelve'
import { consola } from 'consola'
import defu from 'defu'
import { createShelveClient } from '../shelve-client'
import { transformEnvVars } from '../utils/transform'

const logger = consola.withTag('safe-runtime-config')

export default async (): Promise<void> => {
  const cfg = shelveRuntimeConfig
  const token = process.env.SHELVE_TOKEN
  if (!token) {
    logger.warn('SHELVE_TOKEN not set, skipping runtime secrets fetch')
    return
  }

  const client = createShelveClient({ token, url: cfg.url })

  try {
    const [project, environment] = await Promise.all([
      client.getProjectByName(cfg.slug, cfg.project),
      client.getEnvironment(cfg.slug, cfg.environment),
    ])
    const variables = await client.getVariables(cfg.slug, project.id, environment.id)

    if (variables.length === 0) {
      logger.info('No Shelve variables found')
      return
    }

    const secrets = transformEnvVars(variables)
    const config = useRuntimeConfig()
    Object.assign(config, defu(secrets, config))
    logger.success(`Loaded ${variables.length} secrets from Shelve (runtime)`)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to fetch Shelve secrets: ${msg}`)
  }
}
