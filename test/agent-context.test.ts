import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rootDir = fileURLToPath(new URL('..', import.meta.url))

describe('agent context metadata', () => {
  it('advertises docs from package metadata', () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      docs?: string
      homepage?: string
    }

    expect(pkg.homepage).toBe('https://nuxt-safe-runtime-config.onmax.me')
    expect(pkg.docs).toBe('https://nuxt-safe-runtime-config.onmax.me')
  })

  it('publishes a well-known skill for module-specific context', () => {
    const indexPath = join(rootDir, 'docs/public/.well-known/skills/index.json')
    const skillPath = join(rootDir, 'docs/public/.well-known/skills/nuxt-safe-runtime-config/SKILL.md')
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      skills?: Array<{ name?: string, description?: string, files?: string[] }>
    }

    expect(existsSync(skillPath)).toBe(true)
    expect(index.skills).toEqual([
      {
        name: 'nuxt-safe-runtime-config',
        description: 'Use Nuxt Safe Runtime Config to validate Nuxt runtimeConfig with Standard Schema and consume it through typed generated helpers.',
        files: ['SKILL.md'],
      },
    ])

    const skill = readFileSync(skillPath, 'utf8')
    expect(skill).toContain('useSafeRuntimeConfig()')
    expect(skill).toContain('safeRuntimeConfig.$schema')
    expect(skill.toLowerCase()).not.toContain('shelve')
  })
})
