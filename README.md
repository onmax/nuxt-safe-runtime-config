<h1 align="center"><img src="https://raw.githubusercontent.com/onmax/nuxt-safe-runtime-config/main/.github/logo.svg" alt="" width="32" height="32" style="vertical-align: middle;"> Nuxt Safe Runtime Config</h1>

<p align="center">
<b>Deprecated.</b> Nuxt 4.7 checks runtimeConfig schemas itself.
</p>

<p align="center">
  <a href="https://nuxt-safe-runtime-config.onmax.me">Migration guide</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config">
    <img src="https://comark-ui.onmax.me/badge.svg?source=npm-version&amp;package=nuxt-safe-runtime-config&amp;icon=npm" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config">
    <img src="https://comark-ui.onmax.me/badge.svg?source=npm-downloads&amp;package=nuxt-safe-runtime-config&amp;icon=npm" alt="npm downloads" />
  </a>
  <a href="https://github.com/onmax/nuxt-safe-runtime-config/blob/main/LICENSE">
    <img src="https://comark-ui.onmax.me/badge.svg?label=license&amp;value=MIT" alt="License" />
  </a>
</p>

> [!WARNING]
> This module is deprecated. Nuxt 4.7 accepts a Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot wrapped in `toStandardJsonSchema()`) in `runtimeConfig`, converts `NUXT_*` strings to its types, refuses to start on a missing or mistyped value, and types `useRuntimeConfig()`. Move your schema there with one command:
>
> ```bash
> npx nuxt-safe-runtime-config@latest migrate --dry-run   # print the changes and the report, write nothing
> npx nuxt-safe-runtime-config@latest migrate             # apply them
> ```
>
> Pass a directory when the app isn't in the current one: `npx nuxt-safe-runtime-config@latest migrate apps/web`. The codemod needs Nuxt 4.7 or later. If you use Zod or ArkType, upgrade to Zod 4.2 or ArkType 2.1.28 first.

The [migration guide](https://nuxt-safe-runtime-config.onmax.me) covers what the codemod changes, when it stops, and what Nuxt doesn't check:

- Nuxt doesn't run URL formats, minimums and maximums, patterns or `.refine()`. The codemod lists each one in its report.
- A schema in `nuxt.config.ts` always stops the server on a bad value. `onError: 'warn' | 'ignore'` has no equivalent.
- Apps that use `envSchema` move to [ViteHub Env on Nuxt 5](https://nuxt-safe-runtime-config.onmax.me/guide/migrate-to-vitehub-env). Nitro apps without Nuxt move to [ViteHub Env on Nitro 3](https://vitehub.dev/docs/getting-started/installation). Apps whose schema has transforms can pin `nuxt-safe-runtime-config@1.0.0`, which keeps working.

## Maintenance

The repository and the docs site stay online in maintenance mode:

- Security fixes and severe bugs only. No new features.
- [Report a vulnerability privately on GitHub](https://github.com/onmax/nuxt-safe-runtime-config/security/advisories/new). Don't open a public issue for it.

## Reference

For apps that still run the module. The [old guides](https://nuxt-safe-runtime-config.onmax.me/guide) describe it in full.

```ts
// nuxt.config.ts
import * as v from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    databaseUrl: '',
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: {
    $schema: v.object({
      databaseUrl: v.pipe(v.string(), v.url()),
      public: v.object({ apiBase: v.pipe(v.string(), v.url()) }),
    }),
  },
})
```

The module checks the schema during `nuxt build` and again when the server starts, after `NUXT_*` overrides. `useSafeRuntimeConfig()` returns the values typed from the schema; pass `event` in server handlers. [Configuration](https://nuxt-safe-runtime-config.onmax.me/reference/configuration) lists every option.

## Contribution

<details>
  <summary>Local development</summary>

```bash
# Install dependencies
pnpm install

# Generate type stubs
pnpm run dev:prepare

# Develop with the playground
pnpm run dev

# Build the playground
pnpm run dev:build

# Run ESLint
pnpm run lint

# Run Vitest
pnpm run test
pnpm run test:watch
```

Releases go through [uppt](https://github.com/danielroe/uppt). Every push to `main` updates a draft `release/vX.Y.Z` PR built from conventional commits. Merging it tags the version, creates the GitHub release, and publishes the package to npm through OIDC trusted publishing. If publishing fails after the tag exists, run `gh workflow run release.yml --ref vX.Y.Z`.

</details>
