import { RuleTester } from '@typescript-eslint/rule-tester'
import { describe, it } from 'vitest'
import rule from '../src/eslint/rules/prefer-safe-runtime-config'

RuleTester.afterAll = () => {}
RuleTester.it = it
RuleTester.describe = describe

const ruleTester = new RuleTester()

ruleTester.run('prefer-safe-runtime-config', rule, {
  valid: [
    { code: 'const config = useSafeRuntimeConfig()' },
    { code: 'const config = useSafeRuntimeConfig(); console.log(config)' },
    { code: 'function foo() { return useSafeRuntimeConfig() }' },
    { code: 'const runtimeConfig = someOtherFunction()' },
  ],
  invalid: [
    {
      code: 'const config = useRuntimeConfig()',
      errors: [{ messageId: 'preferSafe' }],
      output: 'const config = useSafeRuntimeConfig()',
    },
    {
      code: 'function foo() { return useRuntimeConfig() }',
      errors: [{ messageId: 'preferSafe' }],
      output: 'function foo() { return useSafeRuntimeConfig() }',
    },
    {
      code: 'const { public } = useRuntimeConfig()',
      errors: [{ messageId: 'preferSafe' }],
      output: 'const { public } = useSafeRuntimeConfig()',
    },
  ],
})
