<h1 align="center">
  <img alt="Nuxt safe runtime config logo" loading="lazy" width="50" height="50" decoding="async" data-nimg="1" style="color:transparent" src="https://raw.githubusercontent.com/onmax/nuxt-safe-runtime-config/refs/heads/main/.github/logo.svg" />
  </br>
  Nuxt Safe Runtime Config</h1>
<p align="center">
Validate Nuxt runtime config at build time using <b>Zod</b>, <b>Valibot</b>, <b>ArkType</b>, or any Standard Schema compatible library.
</p>
<br/>

<p align="center">
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config">
    <img src="https://img.shields.io/npm/v/nuxt-safe-runtime-config.svg" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config">
    <img src="https://img.shields.io/npm/dm/nuxt-safe-runtime-config.svg" alt="npm downloads" />
  </a>
  <a href="https://github.com/onmax/nuxt-safe-runtime-config/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/onmax/nuxt-safe-runtime-config.svg" alt="License" />
  </a>
  <a href="https://nuxt.com">
    <img src="https://img.shields.io/badge/Nuxt-3.0+-00DC82.svg" alt="Nuxt" />
  </a>

  <p align="center">
    <a href="https://github.com/nuxt/nuxt/discussions/32301">
      🔗 Related Nuxt RFC: Enable Standard Schema Validation in Nuxt Config
    </a>
  </p>
</p>

## Features

- 🔒 **Build-time validation** with Zod, Valibot, ArkType, or any [Standard Schema](https://standardschema.dev/) library
- 🚀 **Runtime validation** (opt-in) validates config when the server starts
- ✨ **Auto-generated types** — `useSafeRuntimeConfig()` is fully typed without manual generics
- 🛠 **ESLint plugin** warns when using `useRuntimeConfig()` instead of the type-safe composable
- ⚡ **Zero runtime overhead** by default — validation happens at build time only

## Quick Setup

Install the module:

```bash
npx nuxi module add nuxt-safe-runtime-config
```

## Usage

### 1. Define your schema

Use Zod, Valibot, ArkType, or any Standard Schema compatible library:

<details>
<summary>With Valibot</summary>

```typescript
import { number, object, optional, string } from 'valibot'

const runtimeConfigSchema = object({
  public: object({
    apiBase: string(),
    appName: optional(string()),
  }),
  databaseUrl: string(),
  secretKey: string(),
  port: optional(number()),
})
```

</details>

<details>
<summary>With Zod</summary>

```typescript
import { z } from 'zod'

const runtimeConfigSchema = z.object({
  public: z.object({
    apiBase: z.string(),
    appName: z.string().optional(),
  }),
  databaseUrl: z.string(),
  secretKey: z.string(),
  port: z.number().optional(),
})
```

</details>

<details>
<summary>With ArkType</summary>

```typescript
import { type } from 'arktype'

const runtimeConfigSchema = type({
  'public': {
    'apiBase': 'string',
    'appName?': 'string'
  },
  'databaseUrl': 'string',
  'secretKey': 'string',
  'port?': 'number'
})
```

</details>

### 2. Configure in nuxt.config.ts

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb',
    secretKey: process.env.SECRET_KEY || 'default-secret-key',
    port: Number.parseInt(process.env.PORT || '3000'),
    public: {
      apiBase: process.env.PUBLIC_API_BASE || 'https://api.example.com',
      appName: 'My Nuxt App',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
```

### 3. Use the type-safe composable

Access your validated config with full type safety — types are auto-generated from your schema:

```vue
<script setup lang="ts">
const config = useSafeRuntimeConfig()
// config.public.apiBase is typed as string
// config.secretKey is typed as string
</script>
```

## Configuration Options

| Option              | Type                            | Default           | Description                                |
| ------------------- | ------------------------------- | ----------------- | ------------------------------------------ |
| `$schema`           | `StandardSchemaV1`              | —                 | Your validation schema (required)          |
| `validateAtBuild`   | `boolean`                       | `true`            | Validate during dev/build                  |
| `validateAtRuntime` | `boolean`                       | `false`           | Validate when server starts                |
| `onBuildError`      | `'throw' \| 'warn' \| 'ignore'` | `'throw'`         | How to handle build validation errors      |
| `onRuntimeError`    | `'throw' \| 'warn' \| 'ignore'` | `'throw'`         | How to handle runtime validation errors    |
| `logSuccess`        | `boolean`                       | `true`            | Log successful validation                  |
| `logFallback`       | `boolean`                       | `true`            | Log when using JSON Schema fallback        |
| `jsonSchemaTarget`  | `string`                        | `'draft-2020-12'` | JSON Schema version for runtime validation |

## Runtime Validation

By default, validation only runs at build time. Enable runtime validation to catch environment variable issues when the server starts:

```ts
export default defineNuxtConfig({
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
  },
})
```

Runtime validation uses [@cfworker/json-schema](https://github.com/cfworker/cfworker/tree/main/packages/json-schema) to validate the config after environment variables are merged. This lightweight validator (~8KB) works on all runtimes including edge (Cloudflare Workers, Vercel Edge, Netlify Edge). It catches issues like:

- Environment variables with wrong types (e.g., `NUXT_PORT=abc` when expecting a number)
- Missing required environment variables in production
- Invalid values that pass build-time checks but fail at runtime

## ESLint Integration

The module includes an ESLint plugin that warns when using `useRuntimeConfig()` instead of `useSafeRuntimeConfig()`.

### With @nuxt/eslint (Automatic)

If you use [@nuxt/eslint](https://eslint.nuxt.com), the rule is auto-registered. No configuration needed.

### Manual Setup

Add to your `eslint.config.mjs`:

```javascript
import { configs } from 'nuxt-safe-runtime-config/eslint'

export default [
  configs.recommended,
  // ... your other configs
]
```

Or configure manually:

```javascript
import plugin from 'nuxt-safe-runtime-config/eslint'

export default [
  {
    plugins: { 'safe-runtime-config': plugin },
    rules: { 'safe-runtime-config/prefer-safe-runtime-config': 'warn' },
  },
]
```

The rule includes auto-fix support — run `eslint --fix` to automatically replace `useRuntimeConfig()` calls.

## Type Safety

Types are auto-generated at build time from your schema's JSON Schema representation. The `useSafeRuntimeConfig()` composable returns a fully typed object — no manual generics needed:

```ts
const config = useSafeRuntimeConfig()
// config is fully typed based on your schema
```

Generated types are stored in `.nuxt/types/safe-runtime-config.d.ts` and automatically included in your project.

## Error Messages

When validation fails, you see detailed error messages:

```
[safe-runtime-config] Validation failed!
  1. databaseUrl: Invalid type: Expected string but received undefined
  2. public.apiBase: Invalid type: Expected string but received undefined
  3. port: Invalid type: Expected number but received string
```

The module stops the build process until all validation errors are resolved.

## Why This Module?

Nuxt's built-in schema validation is designed for module authors and broader configuration. This module focuses specifically on **runtime config validation** using Standard Schema, allowing you to:

- Use your preferred validation library (Valibot, Zod, ArkType)
- Catch configuration errors at build time
- Optionally validate at runtime for environment variable issues
- Get full type safety in your components

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

# Release new version
pnpm run release
```

</details>
