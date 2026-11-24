---
title: Migrate to Nuxt runtime config
description: nuxt-safe-runtime-config is deprecated. Nuxt 4.7 checks runtimeConfig schemas itself, and one command moves your schema there.
navigation: false
---

::u-page-hero
---
title: Migrate to Nuxt runtime config
description: This module is deprecated. Nuxt 4.7 checks runtimeConfig schemas itself, and one command moves your schema there.
links:
  - label: Run the codemod
    to: '#run-the-codemod'
    icon: i-ph-terminal
    size: xl
  - label: Why it's deprecated
    to: /blog/deprecating-nuxt-safe-runtime-config
    color: neutral
    variant: outline
    icon: i-ph-newspaper
    size: xl
  - label: Old guides
    to: /guide
    color: neutral
    variant: outline
    icon: i-ph-book-open
    size: xl
---
::

::u-container{class="max-w-4xl pb-24"}
## Why

Nuxt 4.7 accepts a schema that implements [Standard JSON Schema](https://standardschema.dev/json-schema) anywhere in `runtimeConfig`: Zod 4.2 or later, ArkType 2.1.28 or later, or Valibot wrapped in `toStandardJsonSchema()`. From it, Nuxt converts `NUXT_*` strings to the numbers, booleans and JSON the schema asks for, and types `useRuntimeConfig()`. When the server starts with a value that is missing or has the wrong type, it exits with code 1 before it listens:

```txt
[NUXT_E8014] The runtime config does not match its schema:
  - `port` (`NUXT_PORT`) must be number, but received a string.
```

That was most of this module's job. It gets no new features, and the [last release](#maintenance) prints a deprecation warning on every Nuxt version.

## Nuxt 4.7 or ViteHub Env

There are two ways off the module, and each has a codemod.

- **Nuxt runtime config**, the rest of this page. Your schema moves into `runtimeConfig` as you wrote it, and the module goes away with nothing in its place. Start here unless you need something from the next list.
- **[ViteHub Env](/guide/migrate-to-vitehub-env)** replaces runtime config instead of checking it. It reads a `.env.example` as the schema, keeps secrets redacted until you call `.unseal()`, and gives server and app code the same API in Nuxt, Vite and Nitro apps. It needs Nuxt 5 or Nitro 3, and adds `vite-hub` to your dependencies.

| | Nuxt runtime config | ViteHub Env |
| --- | --- | --- |
| Codemod | `npx nuxt-safe-runtime-config@latest migrate` | `npx @vite-hub/codemods nuxt-safe-runtime-config` |
| Needs | Nuxt 4.7 | Nuxt 5 and Node.js 24.15 |
| New dependency | None (`@valibot/to-json-schema` for Valibot) | `vite-hub` |
| Your schema | Stays as written, in `runtimeConfig` | Becomes one Env declaration per value |
| Read the config with | `useRuntimeConfig()` | `useServerEnv(event)`, `usePublicEnv()` |
| `.env.example` as the schema | No | Yes |
| Secrets | Plain strings | `SecretEnv`, redacted until `.unseal()` |
| Nitro without Nuxt | No | Nitro 3 with Vite, by hand |
| `NUXT_PUBLIC_*` overrides | When the server starts | At build time |

## Run the codemod

The codemod needs Nuxt 4.7 or later. On an older version, run `npx nuxt upgrade` first. Upgrade Zod to 4.2 and ArkType to 2.1.28 too. Nuxt rejects older versions, Zod 3 included, with `NUXT_B5031`.

`@latest` makes npx download the release that has the command, instead of running the version your app already has installed.

:::steps

### Preview the changes

```bash
npx nuxt-safe-runtime-config@latest migrate --dry-run
```

`--dry-run` prints what it would change and the report, and writes nothing. Pass a directory when the app isn't in the current one: `npx nuxt-safe-runtime-config@latest migrate apps/web --dry-run`.

### Apply them

```bash
npx nuxt-safe-runtime-config@latest migrate
```

### Install and check

```bash
pnpm install
npx nuxt prepare
npx nuxt typecheck
```

Then run your linter with `--fix`, since the files the codemod wrote may not match your code style. Build and start the server once without a value the schema requires, such as `NUXT_DATABASE_URL` in the example below, to see Nuxt refuse it. Work through the report's follow-ups. Each one has its `file:line`.

:::

## Before and after

A Zod schema in its own file:

:::code-group

```ts [nuxt.config.ts (before)]
export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    databaseUrl: '',
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: { $schema: './runtime-config.schema' },
})
```

```ts [runtime-config.schema.ts (before)]
import { z } from 'zod'

export default z.object({
  databaseUrl: z.string(),
  public: z.object({ apiBase: z.string() }),
})
```

```ts [nuxt.config.ts (after)]
export default defineNuxtConfig({
  modules: [],
  runtimeConfig: {
    public: { apiBase: 'https://api.example.com' },
  },
})
```

```ts [layers/runtime-config/nuxt.config.ts (new)]
import runtimeConfigSchema from '../../runtime-config.schema.ts'

export default defineNuxtConfig({
  runtimeConfig: runtimeConfigSchema,
})
```

:::

Your schema file doesn't change. `runtimeConfig` holds either the schema or plain values, so the schema moves to a layer and `apiBase` stays in your `nuxt.config.ts` as its default. `databaseUrl` stays required: production sets it through `NUXT_DATABASE_URL`, and Nuxt refuses to start without it. Code that called `useSafeRuntimeConfig(event)` now calls `useRuntimeConfig(event)`, typed from the same schema.

## What it changes

- **`package.json`.** It reads the installed Nuxt version and stops below 4.7. It removes `nuxt-safe-runtime-config`. When the schema is Valibot, it adds `@valibot/to-json-schema` and raises a Valibot range below `^1.2.0` to `^1.2.0`, the oldest release `toStandardJsonSchema()` supports. When either one is a `catalog:` dependency, it writes the version into that catalog in `pnpm-workspace.yaml` instead.
- **`nuxt.config.ts`.** It removes the module from `modules` and the `safeRuntimeConfig` block, and moves `$schema` into `runtimeConfig`. A schema given by path becomes an import that keeps its `.ts` extension, because Nuxt 4.7 loads `nuxt.config.ts` with Node's own loader.
- **Defaults.** It removes `''` placeholders. Nuxt would take `''` as the schema's default, and the value would stop being required. When other plain values are left, the schema goes to `layers/runtime-config/nuxt.config.ts` and the plain values stay in your `nuxt.config.ts` as defaults. When none are left, the schema goes straight into `runtimeConfig`.
- **Valibot schemas.** It wraps them in `toStandardJsonSchema()`. Nuxt rejects a raw Valibot schema with `NUXT_B5031`.
- **Your code.** In `app/`, `server/` and `layers/`, it renames `useSafeRuntimeConfig(…)` to `useRuntimeConfig(…)` and keeps the arguments. When the app builds with Nitro 2 and a call without arguments sits inside a `defineEventHandler` (or a similar Nitro handler) whose event parameter is in scope, it passes that parameter. Any other call keeps no arguments. On Nitro 2, the report lists the server calls that have no event in scope under "Check by hand", so you can pass one yourself. Calls inside a Vue `<template>` aren't renamed. The report lists them under "Check by hand".
- **ESLint.** It removes the `nuxt-safe-runtime-config/eslint` import and the `prefer-safe-runtime-config` rule.
- **The report.** It lists each refinement Nuxt won't check, and each option whose behaviour changes: `onError`, `validateAtRuntime: false` and `requireAtBuild`. When plain values stay in `nuxt.config.ts`, it checks them against the schema as they are when the config loads, and lists the required values that have none and the values of the wrong type that it finds. This check doesn't cover every schema, such as the items of an array, so the server start check is the one to rely on. It doesn't change your schema for them.

## When it stops

The codemod stops before it changes a file when the app needs something Nuxt doesn't have:

| The app uses | Go to |
| --- | --- |
| Nuxt below 4.7 | `npx nuxt upgrade`, then run the codemod again |
| `envSchema` (a `.env.example` as the schema) | [ViteHub Env](/guide/migrate-to-vitehub-env), which needs Nuxt 5. Nuxt can't read `.env.example`, and Env keeps the file as it is. If you can't move to Nuxt 5 yet and don't need `.env.example` as the schema, write the schema by hand on 4.7: see [`envSchema` by hand](#envschema-by-hand). Otherwise stay on the module |
| `nuxt-safe-runtime-config/nitro`, in a Nitro app without Nuxt | [ViteHub Env](https://vitehub.dev/docs/getting-started/installation), which needs Nitro 3 with Vite. Nitro has no runtime config schemas. The Nuxt codemods don't cover these apps |
| Transforms, such as Zod's `.transform()` or Valibot's `v.transform()` and `v.trim()` | Pin `nuxt-safe-runtime-config@0.5.0`, which keeps working, or move each transform to where the value is read and run the codemod again |
| Asynchronous checks | Nuxt validates synchronously. Move the check to where the value is used, then run the codemod again |
| A `nuxt.config.ts` or schema it can't edit safely | [Do it by hand](#doing-it-by-hand) |

## Known limitations

Nuxt checks types, required values, enums and unions. Some things the module did have no equivalent:

- **Refinements aren't checked.** Nuxt doesn't run URL and email formats, minimums and maximums, patterns, `.refine()` or `.trim()`. `NUXT_PUBLIC_API_BASE=not-a-url` starts fine. The codemod lists each one in its report. Check the values that matter where your code reads them.
- **No `onError: 'warn'` or `'ignore'`.** A schema in `nuxt.config.ts` always stops the server on a bad value. `validateAtRuntime: false` has no equivalent either.
- **No `requireAtBuild`.** A missing required value prints a `NUXT_B5032` warning during `nuxt build`, and the server refuses to start without it.
- **Plain defaults move to a layer.** `runtimeConfig` holds one value, so a whole-config schema and plain values can't share it in one `nuxt.config.ts`. Across layers, the plain values become the schema's defaults, which is why the codemod writes `layers/runtime-config/nuxt.config.ts` when plain values are left.

## What Nuxt 4.7 replaces

| Feature | Module | Nuxt 4.7 |
| --- | --- | --- |
| Types, required values, enums, unions | Yes | Yes |
| `NUXT_*` coercion to number, boolean, JSON | Yes | Yes, for values with a schema (all values with `compatibilityVersion: 5`) |
| Typed config | `useSafeRuntimeConfig()` | `useRuntimeConfig()` |
| Zod, ArkType | Yes | Zod 4.2+, ArkType 2.1.28+ |
| Valibot | Yes | Wrapped in `toStandardJsonSchema()` |
| URL formats, min/max, patterns, `.refine()` | Yes | No, the codemod reports them |
| Transforms | Yes | No, the schema can't move |
| `onError: 'warn' \| 'ignore'` | Yes | No. A schema in `nuxt.config.ts` always stops the server |
| `envSchema` from `.env.example` | Yes (experimental) | No, see [ViteHub Env](/guide/migrate-to-vitehub-env) on Nuxt 5 |
| Nitro without Nuxt (`/nitro`) | Yes | No, see [ViteHub Env](https://vitehub.dev/docs/getting-started/installation) on Nitro 3 |

## Doing it by hand

If you'd rather not run the codemod, these are the same steps:

1. Upgrade to Nuxt 4.7 or later with `npx nuxt upgrade`, Zod to 4.2 or later, and ArkType to 2.1.28 or later.
2. Remove `nuxt-safe-runtime-config` from `package.json` and from `modules`, and delete the `safeRuntimeConfig` block.
3. Set `runtimeConfig` to your schema. Import a schema file with its `.ts` extension. For Valibot, install `@valibot/to-json-schema`, which the module used to bring, and wrap the schema in its `toStandardJsonSchema()`.
4. Drop the `''` placeholders. Move other defaults into the schema, or put the schema in a layer and keep the plain values in your root `nuxt.config.ts`.
5. Rename `useSafeRuntimeConfig` to `useRuntimeConfig`, with the same arguments.
6. Remove `nuxt-safe-runtime-config/eslint` from your ESLint config.
7. Run `npx nuxt typecheck`, then start the server with a bad `NUXT_*` value and check that it refuses.

### `envSchema` by hand

Nuxt 4.7 can't read `.env.example`, but you can write the same rules as a schema. Keep each value at the path the module uses today: `NUXT_PUBLIC_*` keys under `public`, other keys at the root, and `envSchema.paths` mappings where they point. While the module is still installed, `npx nuxt prepare` writes `.nuxt/types/safe-runtime-config.d.ts`, which lists those paths, their types and which ones are optional. For defaults, take the header rules such as `@defaultRequired` and how each default is parsed from the [env-spec reference](/reference/env-spec). Then follow the steps above from step 2, and delete `envSchema` from `safeRuntimeConfig`. The [known limitations](#known-limitations) apply, so formats and patterns in the file aren't checked.

## Maintenance

The module is in maintenance mode. The repository and this site stay online.

- Security fixes and severe bugs only. No new features or schema sources.
- `nuxt-safe-runtime-config@0.5.0` is the last release. It works as before and warns that the module is deprecated.
- [Report a vulnerability privately on GitHub](https://github.com/onmax/nuxt-safe-runtime-config/security/advisories/new). Don't open a public issue for it.

The [old guides](/guide) still describe how the module works, for apps that stay on it for now.
::
