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
    <img src="https://img.shields.io/badge/Nuxt-3%20%7C%204%20%7C%205%20nightly-00DC82.svg" alt="Nuxt compatibility" />
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
- 🔐 **Shelve integration** — fetch secrets from [Shelve](https://shelve.cloud) and merge into runtime config

## Quick Setup

Install the module:

```bash
npx nuxi module add nuxt-safe-runtime-config
```

## Compatibility

This module supports Nuxt 3 and Nuxt 4. It is also tested against Nuxt 4.2+ with `future.compatibilityVersion: 5` and against the Nuxt 5 nightly channel (`nuxt-nightly@5x`).

Inline runtime schemas are converted to JSON Schema. Importable schema modules can instead execute the original Standard Schema at runtime, including transformations.

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

You can also use the same composable in server code:

```ts
// server/utils/config.ts
export function getPrivateConfig() {
  const config = useSafeRuntimeConfig()
  return {
    secretKey: config.secretKey,
    apiBase: config.public.apiBase,
  }
}
```

If your editor runs type-checking outside Nuxt's auto-import context, import it explicitly:

```ts
import { useSafeRuntimeConfig } from '#imports'
```

## Configuration Options

| Option              | Type                            | Default           | Description                                 |
| ------------------- | ------------------------------- | ----------------- | ------------------------------------------- |
| `$schema`           | `StandardSchemaV1 \| string`    | —                 | Schema or path to its default-export module |
| `validateAtBuild`   | `boolean`                       | `true`            | Validate during dev/build                   |
| `validateAtRuntime` | `boolean`                       | `false`           | Validate when server starts                 |
| `onError`           | `'throw' \| 'warn' \| 'ignore'` | `'throw'`         | How to handle validation errors             |
| `jsonSchemaTarget`  | `string`                        | `'draft-2020-12'` | JSON Schema version for runtime validation  |
| `shelve`            | `boolean \| ShelveOptions`      | `undefined`       | Shelve secrets integration (see below)      |

## Shelve Integration

[Shelve](https://shelve.cloud) is a secrets management service. This module fetches secrets from Shelve at build time and merges them into your runtime config before validation.

### Configure Shelve

Configure Shelve directly in your Nuxt config:

```ts
export default defineNuxtConfig({
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    shelve: {
      project: 'my-app',
      slug: 'my-team',
    },
  },
})
```

The module resolves configuration from multiple sources (highest priority first):

| Config      | Sources                                                      |
| ----------- | ------------------------------------------------------------ |
| project     | `nuxt.config` → `SHELVE_PROJECT` → `package.json` name       |
| slug        | `nuxt.config.slug/team` → `SHELVE_TEAM` → `SHELVE_TEAM_SLUG` |
| environment | `nuxt.config` → `SHELVE_ENV` → dev mode auto                 |
| url         | `nuxt.config` → `SHELVE_URL` → `https://app.shelve.cloud`    |
| token       | `SHELVE_TOKEN` → `~/.shelve`                                 |

### Explicit Configuration

You can override any auto-detected value:

```ts
export default defineNuxtConfig({
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    shelve: {
      project: 'my-app',
      slug: 'my-team',
      environment: 'production',
      url: 'https://app.shelve.cloud', // Self-hosted Shelve
      fetchAtBuild: true, // Default: fetch at build time
      fetchAtRuntime: false, // Opt-in: fetch on server cold start
    },
  },
})
```

### Variable Transformation

Shelve variables transform from `SCREAMING_SNAKE_CASE` to `camelCase` with smart grouping:

```
DATABASE_URL           → databaseUrl
GITHUB_CLIENT_ID       → github.clientId (grouped)
GITHUB_CLIENT_SECRET   → github.clientSecret (grouped)
PUBLIC_API_URL         → public.apiUrl
```

Variables with repeated prefixes (2+ keys) nest automatically. `PUBLIC_*` and `NUXT_PUBLIC_*` map to `runtimeConfig.public`.

### Runtime Fetch (Opt-in)

For dynamic environments or secret rotation, enable runtime fetching:

```ts
export default defineNuxtConfig({
  safeRuntimeConfig: {
    shelve: {
      fetchAtBuild: true, // Bake secrets into build
      fetchAtRuntime: true, // Also refresh on cold start
    },
  },
})
```

The runtime plugin runs before validation, so freshly fetched secrets are validated against your schema.

### Install Wizard UX

On module install, an interactive setup wizard can help bootstrap validation and Shelve config. The wizard now:

- shows a preview of planned actions first (install deps, write `~/.shelve`, edit `nuxt.config`)
- asks for a final confirmation before applying any change
- skips automatically in CI and non-interactive terminals (non-TTY)

## Runtime Validation

By default, validation only runs at build time. Existing inline schemas can opt into JSON Schema validation when the server starts:

```ts
export default defineNuxtConfig({
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
    onError: 'throw',
  },
})
```

This path uses [@cfworker/json-schema](https://github.com/cfworker/cfworker/tree/main/packages/json-schema) after environment variables are merged. To execute Standard Schema transformations, default-export the schema from an importable module:

```ts [runtime-config.schema.ts]
import * as v from 'valibot'

export default v.pipe(
  v.object({ enabled: v.union([v.boolean(), v.string()]) }),
  v.transform(config => ({ enabled: config.enabled === true || config.enabled === 'true' })),
  v.object({ enabled: v.boolean() }),
)
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  safeRuntimeConfig: {
    $schema: './runtime-config.schema',
    validateAtRuntime: true,
  },
})
```

The server executes that module once after Nitro applies runtime overrides. Request handlers wait for asynchronous schemas, `useSafeRuntimeConfig()` returns the validated output, and transformed `public` values are serialized into the Nuxt client payload. Inline schemas keep the JSON Schema path for compatibility.

Runtime validation catches:

- Environment variables with wrong types (e.g., `NUXT_PORT=abc` when expecting a number)
- Missing required environment variables in production
- Invalid values that pass build-time checks but fail at runtime

Shelve runtime fetching is separate from validation ownership. If `shelve.fetchAtRuntime` is enabled, the Shelve runtime plugin runs before validation so fetched secrets are included in the validated config.

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

Types are generated from JSON Schema for inline schemas and from Standard Schema's output type for schema modules. The `useSafeRuntimeConfig()` composable returns a fully typed object in both app and server contexts (`app.vue`, `server/api`, `server/utils`) — no manual generics needed:

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

## Upcoming Major Release Notes

- Shelve setup no longer documents `shelve.json` auto-enablement; supported sources are `nuxt.config`, env vars, and `package.json` fallback for project name.
- The install wizard now previews actions and requires explicit confirmation before mutating files or writing credentials.
- Runtime and wizard key-shaping now use the same env-key mapping rules to avoid schema/runtime drift.

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
