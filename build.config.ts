import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    { input: 'src/nitro', name: 'nitro' },
    { input: 'src/eslint/index', name: 'eslint' },
    { input: 'src/migrate/cli', name: 'cli' },
  ],
  declaration: true,
  clean: false,
  rollup: { emitCJS: false, inlineDependencies: ['@babel/parser', 'semver'] },
  externals: ['@nuxt/kit', '@typescript-eslint/utils', '@typescript-eslint/types', 'eslint'],
})
