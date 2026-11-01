import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('well-known skill', () => {
  it('serves the same skill at the compatibility path', () => {
    const skillsDir = new URL('../docs/public/.well-known/skills/', import.meta.url)
    const skill = readFileSync(new URL('nuxt-safe-runtime-config/SKILL.md', skillsDir), 'utf8')
    const compatibilitySkill = readFileSync(new URL('SKILL.md', skillsDir), 'utf8')

    expect(compatibilitySkill).toBe(skill)
  })
})
