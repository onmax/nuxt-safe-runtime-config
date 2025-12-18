import { ESLintUtils } from '@typescript-eslint/utils'

const createRule = ESLintUtils.RuleCreator(name => `https://github.com/onmax/nuxt-safe-runtime-config#${name}`)

export default createRule({
  name: 'prefer-safe-runtime-config',
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer useSafeRuntimeConfig() over useRuntimeConfig()' },
    schema: [],
    messages: { preferSafe: 'Use useSafeRuntimeConfig() for type-safe runtime config' },
    fixable: 'code',
  },
  defaultOptions: [],
  create: context => ({
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'useRuntimeConfig') {
        context.report({
          node,
          messageId: 'preferSafe',
          fix: fixer => fixer.replaceText(node.callee, 'useSafeRuntimeConfig'),
        })
      }
    },
  }),
})
