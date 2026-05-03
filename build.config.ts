import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    { input: 'src/nitro', name: 'nitro' },
    { input: 'src/eslint/index', name: 'eslint' },
  ],
  declaration: true,
  clean: false,
  rollup: { emitCJS: false },
  externals: ['@nuxt/kit', '@typescript-eslint/utils', '@typescript-eslint/types', 'eslint'],
})
