# Nuxt Safe Runtime Config

Use this when modifying a Nuxt app that depends on `nuxt-safe-runtime-config`, or when adding typed runtime config validation to a Nuxt app.

## Core model

- Configure the module with `safeRuntimeConfig.$schema`.
- The schema must implement Standard Schema. Zod, Valibot, ArkType, and other Standard Schema compatible libraries are supported.
- Build-time validation is enabled by default. Runtime validation is opt-in with `validateAtRuntime: true`.
- `useSafeRuntimeConfig()` is the typed accessor for app code, server routes, and server utilities.
- Generated types live under `.nuxt/types/safe-runtime-config.d.ts`; never edit generated files directly.

## Editing workflow

1. When adding or renaming a runtime config key, update both `runtimeConfig` and the Standard Schema in `safeRuntimeConfig.$schema`.
2. Prefer `useSafeRuntimeConfig()` over `useRuntimeConfig()` wherever typed access matters.
3. If an editor or utility file runs outside Nuxt auto-import context, import the composable from `#imports`.
4. Do not ask consumers to install JSON Schema converter packages for Zod or Valibot; the module includes the conversion path.
5. After config or schema changes, run `nuxi prepare` or the project typecheck so generated types refresh.

## Validation behavior

- `onError: 'throw'` is the default and should stay in CI-facing validation paths.
- Use `onError: 'warn'` only for migration periods where missing values are expected.
- Use `validateAtRuntime: true` when deployment-time environment variables can differ from build-time values.
- Treat validation failures as configuration bugs; do not patch around them by casting the config to `any`.

## Type-safety checks

- `config.public.*` should reflect public runtime config keys.
- Private runtime config keys should stay off `config.public`.
- Unknown keys should fail typechecking after the generated declarations are refreshed.
