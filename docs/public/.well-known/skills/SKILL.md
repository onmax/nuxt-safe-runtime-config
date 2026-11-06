# Nuxt Safe Runtime Config

Use this when modifying a Nuxt app that depends on `nuxt-safe-runtime-config`, or when adding typed runtime config validation to a Nuxt app. Full docs: https://nuxt-safe-runtime-config.onmax.me (append `/raw/<path>.md` for Markdown).

## Core model

- The schema comes from one source: `safeRuntimeConfig.$schema` (a Standard Schema such as Zod, Valibot or ArkType, or a project-relative path to a module that default-exports one) or `safeRuntimeConfig.envSchema` (an annotated `.env.example`, experimental). Never set both.
- There is no option for when validation runs. The build check runs the schema on `nuxt.config.ts` values and fails on wrong values, but leaves `undefined` or `''` values to the server. The server start check (also run by the `nuxt generate` prerender server) validates the values after `NUXT_*` overrides, missing ones included. `requireAtBuild: true` makes missing values fail the build too, for CI that has every production value. `envSchema` validates only at server start.
- `validateAtBuild` and `validateAtRuntime` are deprecated. Remove `validateAtRuntime: true`; replace `validateAtBuild: true` with `requireAtBuild: true`.
- Leave values that production sets through `NUXT_*` variables as `''` in `runtimeConfig`.
- `useSafeRuntimeConfig()` is the typed accessor in app code, server routes and server utilities. In server handlers, pass the event: `useSafeRuntimeConfig(event)`.
- Generated types live in `.nuxt/types/safe-runtime-config.d.ts`. Never edit generated files.

## Editing workflow

1. When adding or renaming a runtime config key, update both `runtimeConfig` and the schema (or the `.env.example` entry).
2. Prefer `useSafeRuntimeConfig()` over `useRuntimeConfig()` wherever typed access matters.
3. If a file runs outside Nuxt auto-import context, import the composable from `#imports`.
4. Do not install JSON Schema converter packages for Zod or Valibot; the module ships them.
5. After config or schema changes, run `nuxi prepare` or the project typecheck so generated types refresh.

## Runtime values

- At server start, `NUXT_*` strings are coerced to the schema's booleans, numbers, enums, arrays and objects. Do not add `z.coerce`, manual `=== 'true'` checks or `Number()` calls for these.
- An inline `$schema` must convert to JSON Schema. For transforms, refinements or other code-only rules, move the schema to a file and set `$schema: './runtime-config.schema'`. Keep parsing in that schema, not in consumers.

## Validation behavior

- `onError: 'throw'` is the default and should stay in CI and production.
- Use `onError: 'warn'` only for migration periods where missing values are expected.
- Treat validation failures as configuration bugs; do not patch around them by casting the config to `any`.

## Type-safety checks

- `config.public.*` should reflect public runtime config keys.
- Private keys are typed on the client but `undefined` there at runtime; read them in `server/` only.
- Unknown keys should fail typechecking after the generated declarations are refreshed.
