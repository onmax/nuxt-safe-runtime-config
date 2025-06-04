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
    <img src="https://img.shields.io/badge/Nuxt-3.0-00DC82.svg" alt="Nuxt" />
  </a>
</p>


## Features

- 🔒 &nbsp;Validate runtime config at build time with **Zod**, **Valibot**, **ArkType**, and more
- 🚀 &nbsp;Works with any [Standard Schema](https://standardschema.dev/) compatible library
- 🛠 &nbsp;Only runs during dev/build/generate phases
- ⚡ &nbsp;Zero runtime overhead - validation happens at build time only
- 📝 &nbsp;Does not modify your runtime config or types - only validates them

## Quick Setup

Install the module to your Nuxt application with one command:

```bash
npx nuxi module add nuxt-safe-runtime-config
```

## Usage

1. Add the module to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config']
})
```

2. Define your runtime config schema using **Valibot**, **Zod**, **ArkType**, or any other Standard Schema compatible library:

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

3. Configure your Nuxt app:

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],

  // Your regular runtime config
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb',
    secretKey: process.env.SECRET_KEY || 'default-secret-key',
    port: Number.parseInt(process.env.PORT || '3000'),
    public: {
      apiBase: process.env.PUBLIC_API_BASE || 'https://api.example.com',
      appName: 'My Nuxt App',
    },
  },

  // Add your schema for validation
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
```

The module will validate your runtime config against the schema during:

- `nuxi dev` (development mode)
- `nuxi build`
- `nuxi generate`

If validation fails, the build process will stop with detailed error messages.

## Important Notes

**This module only validates your runtime config - it does not modify it.** Your native `runtimeConfig` remains unchanged, and no TypeScript types are modified. The module simply ensures that your runtime configuration matches your schema at build time, helping you catch configuration errors early in the development process.

## Error Messages

When validation fails, you'll see detailed error messages like:

```
Safe Runtime Config: Validation failed!
  1. databaseUrl: This field is required
  2. public.apiBase: Expected string, received undefined
  3. port: Expected number, received string
```

The module will stop the build process until all validation errors are resolved.

## Why This Module?

I wanted to use **Valibot** for runtime config validation, but Nuxt doesn't currently support Standard Schema. While Nuxt has its own schema validation system, it's primarily designed for module authors and broader Nuxt configuration.

This module focuses specifically on **runtime config validation** using the Standard Schema specification, allowing you to use your preferred validation library (Valibot, Zod, ArkType, etc.).

The goal is to eventually make Standard Schema a first-class citizen in Nuxt. If this module gains enough adoption, I plan to create a PR to add `standardSchema` support to Nuxt core.

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
