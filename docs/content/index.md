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

Then build and start the server once without a value the schema requires, such as `NUXT_DATABASE_URL` in the example below, to see Nuxt refuse it. Work through the report's follow-ups. Each one has its `file:line`.

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
import schema from './runtime-config.schema.ts'

export default defineNuxtConfig({
  runtimeConfig: schema,
})
```

```ts [runtime-config.schema.ts (after)]
import { z } from 'zod'

export default z.object({
  databaseUrl: z.string(),
  public: z.object({ apiBase: z.string().default('https://api.example.com') }),
})
```

:::

`databaseUrl` stays required: production sets it through `NUXT_DATABASE_URL`, and Nuxt refuses to start without it. Code that called `useSafeRuntimeConfig(event)` now calls `useRuntimeConfig(event)`, typed from the same schema.

## What it changes

- **`package.json`.** It reads the installed Nuxt version and stops below 4.7. It removes `nuxt-safe-runtime-config`, and adds `@valibot/to-json-schema` when the schema is Valibot.
- **`nuxt.config.ts`.** It removes the module from `modules` and the `safeRuntimeConfig` block, and moves `$schema` into `runtimeConfig`. A schema given by path becomes an import that keeps its `.ts` extension, because Nuxt 4.7 loads `nuxt.config.ts` with Node's own loader.
- **Defaults.** It removes `''` placeholders. Nuxt would take `''` as the schema's default, and the value would stop being required. Other plain values move into the schema as `.default(x)` in Zod or `v.optional(schema, x)` in Valibot. When that isn't possible, the schema goes to `layers/runtime-config/nuxt.config.ts` and the plain values stay in your `nuxt.config.ts` as defaults.
- **Valibot schemas.** It wraps them in `toStandardJsonSchema()`. Nuxt rejects a raw Valibot schema with `NUXT_B5031`.
- **Your code.** In `app/`, `server/` and `layers/`, it renames `useSafeRuntimeConfig(…)` to `useRuntimeConfig(…)` and keeps the arguments.
- **ESLint.** It removes the `nuxt-safe-runtime-config/eslint` import and the `prefer-safe-runtime-config` rule.
- **The report.** It lists each refinement Nuxt won't check, and each option whose behaviour changes: `onError`, `validateAtRuntime: false` and `requireAtBuild`.

## When it stops

The codemod stops before it changes a file when the app needs something Nuxt doesn't have:

| The app uses | Go to |
| --- | --- |
| Nuxt below 4.7 | `npx nuxt upgrade`, then run the codemod again |
| `envSchema` (a `.env.example` as the schema) | [ViteHub Env](/guide/migrate-to-vitehub-env), which needs Nuxt 5. Nuxt can't read `.env.example`, and Env keeps the file as it is. If you can't move to Nuxt 5 yet and don't need `.env.example` as the schema, write the schema by hand on 4.7: see [`envSchema` by hand](#envschema-by-hand). Otherwise stay on the module |
| `nuxt-safe-runtime-config/nitro`, in a Nitro app without Nuxt | [ViteHub Env](https://vitehub.dev/docs/getting-started/installation), which needs Nitro 3 with Vite. Nitro has no runtime config schemas. The Nuxt codemods don't cover these apps |
| Transforms, such as Zod's `.transform()` or Valibot's `v.transform()` and `v.trim()` | Pin `nuxt-safe-runtime-config@1.0.0`, which keeps working, or move each transform to where the value is read and run the codemod again |
| Asynchronous checks | Nuxt validates synchronously. Move the check to where the value is used, then run the codemod again |
| A `nuxt.config.ts` or schema it can't edit safely | [Do it by hand](#doing-it-by-hand) |

## Known limitations

Nuxt checks types, required values, enums and unions. Some things the module did have no equivalent:

- **Refinements aren't checked.** Nuxt doesn't run URL and email formats, minimums and maximums, patterns, `.refine()` or `.trim()`. `NUXT_PUBLIC_API_BASE=not-a-url` starts fine. The codemod lists each one in its report. Check the values that matter where your code reads them.
- **No `onError: 'warn'` or `'ignore'`.** A schema in `nuxt.config.ts` always stops the server on a bad value. `validateAtRuntime: false` has no equivalent either.
- **No `requireAtBuild`.** A missing required value prints a `NUXT_B5032` warning during `nuxt build`, and the server refuses to start without it.
- **Plain defaults move to a layer.** `runtimeConfig` holds one value, so a whole-config schema and plain values can't share it in one `nuxt.config.ts`. Across layers, the plain values become the schema's defaults, which is why the codemod writes `layers/runtime-config/nuxt.config.ts` when it can't move a default into the schema.

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

Nuxt 4.7 can't read `.env.example`, but you can copy what it declares into a schema. For each key, add a property with its type: `# @type=number` becomes `z.number()`, a value such as `=false` becomes `.default(false)`, `@optional` becomes `.optional()`, and `@public` keys go under `public`. Keys with no value and no `@optional` stay required. Then follow the steps above from step 2, and delete `envSchema` from `safeRuntimeConfig`. The [known limitations](#known-limitations) apply, so formats and patterns in the file aren't checked.

## Maintenance

The module is in maintenance mode. The repository and this site stay online.

- Security fixes and severe bugs only. No new features or schema sources.
- `nuxt-safe-runtime-config@1.0.0` is the last release. It works as before and warns that the module is deprecated.
- [Report a vulnerability privately on GitHub](https://github.com/onmax/nuxt-safe-runtime-config/security/advisories/new). Don't open a public issue for it.

The [old guides](/guide) still describe how the module works, for apps that stay on it for now.
::
