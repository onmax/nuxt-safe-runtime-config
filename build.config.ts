import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [{ input: 'src/eslint/index', name: 'eslint' }],
  declaration: true,
  clean: false,
  rollup: { emitCJS: false },
  externals: ['@typescript-eslint/utils', '@typescript-eslint/types', 'eslint'],
})
