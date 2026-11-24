# Nuxt Safe Runtime Config (deprecated)

Use this when a Nuxt app depends on `nuxt-safe-runtime-config`, or when someone asks for typed or validated runtime config. Migration guide: https://nuxt-safe-runtime-config.onmax.me (append `/raw/<path>.md` for Markdown, `/raw/index.md` for the guide).

## The module is deprecated

Nuxt 4.7 accepts a Standard JSON Schema (Zod 4, ArkType, or Valibot wrapped in `toStandardJsonSchema()`) in `runtimeConfig`. It converts `NUXT_*` strings to the schema's types, refuses to start on a missing or mistyped value (`NUXT_E8014`), and types `useRuntimeConfig()`. The module gets security fixes and severe bug fixes only.

- Never add `nuxt-safe-runtime-config` to an app. Put the schema in `runtimeConfig` instead.
- In an app that has it, migrate it with the codemod below.

## Migrate

1. Check the installed Nuxt version. Below 4.7, run `npx nuxt upgrade` first. Upgrade Zod 3 to Zod 4: Nuxt rejects Zod 3 schemas with `NUXT_B5031`.
2. Run `npx nuxt-safe-runtime-config@latest migrate --dry-run` and read the report. Pass the app directory when it isn't the current one: `npx nuxt-safe-runtime-config@latest migrate <dir> --dry-run`.
3. Run `npx nuxt-safe-runtime-config@latest migrate`, then install dependencies, `npx nuxt prepare` and the project typecheck.
4. Work through each follow-up in the report. Each has a `file:line`.

The codemod removes the module, moves `safeRuntimeConfig.$schema` into `runtimeConfig`, drops `''` placeholders, moves plain defaults into the schema or into `layers/runtime-config/nuxt.config.ts`, wraps Valibot schemas, renames `useSafeRuntimeConfig(…)` to `useRuntimeConfig(…)`, and removes the `nuxt-safe-runtime-config/eslint` rule.

## When the codemod stops

- `envSchema` (`.env.example` as the schema): move to ViteHub Env, which needs Nuxt 5 (https://nuxt-safe-runtime-config.onmax.me/guide/migrate-to-vitehub-env). Below Nuxt 5, keep the module.
- `nuxt-safe-runtime-config/nitro` in a Nitro app without Nuxt: move to ViteHub Env on Nitro 3 with Vite (https://vitehub.dev/docs/getting-started/installation). The Nuxt codemods don't cover it.
- Transforms or asynchronous checks in the schema: move each one to where the value is read and run the codemod again, or pin `nuxt-safe-runtime-config@1.0.0`.
- A config it can't edit: follow "Doing it by hand" in the migration guide.

## Known limitations after migrating

- Nuxt doesn't check URL or email formats, min/max, patterns, `.refine()` or `.trim()`. Check those values where the code reads them. Don't cast the config to `any` to silence a type error.
- A schema in `nuxt.config.ts` always stops the server on a bad value. There is no `onError: 'warn' | 'ignore'`, `validateAtRuntime: false` or `requireAtBuild`.
- Don't add `''` placeholders next to a schema: Nuxt takes `''` as the default and the value stops being required.

## While the module is still installed

- Its options live under `safeRuntimeConfig`: `$schema` or `envSchema`, never both.
- `useSafeRuntimeConfig()` is its typed accessor; pass `event` in server handlers.
- Generated types live in `.nuxt/types/safe-runtime-config.d.ts`. Never edit generated files.
