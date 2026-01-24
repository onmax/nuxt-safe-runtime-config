<h1 align="center">
  <img alt="Nuxt safe runtime config logo" loading="lazy" width="50" height="50" decoding="async" data-nimg="1" style="color:transparent" src="https://raw.githubusercontent.com/onmax/nuxt-safe-runtime-config/refs/heads/main/.github/logo.svg" />
  </br>
  Nuxt Safe Runtime Config</h1>
<p align="center">
Validate Nuxt runtime config at build or runtime using <b>Zod</b>, <b>Valibot</b>, <b>ArkType</b>, or any Standard Schema compatible library.
</p>
<br/>

<p align="center">
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config"><img src="https://img.shields.io/npm/v/nuxt-safe-runtime-config.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/nuxt-safe-runtime-config"><img src="https://img.shields.io/npm/dm/nuxt-safe-runtime-config.svg" alt="npm downloads" /></a>
  <a href="https://github.com/onmax/nuxt-safe-runtime-config/blob/main/LICENSE"><img src="https://img.shields.io/github/license/onmax/nuxt-safe-runtime-config.svg" alt="License" /></a>
  <a href="https://nuxt.com"><img src="https://img.shields.io/badge/Nuxt-3.0+-00DC82.svg" alt="Nuxt" /></a>
</p>

<p align="center">
  <a href="https://nuxt-safe-runtime-config.vercel.app">Documentation</a>
</p>

## Features

- **Build-time validation** with Zod, Valibot, ArkType, or any [Standard Schema](https://standardschema.dev/) library
- **Runtime validation** (opt-in) validates config when the server starts
- **Auto-generated types** - `useSafeRuntimeConfig()` is fully typed
- **ESLint plugin** warns when using `useRuntimeConfig()` instead of the type-safe composable

## Quick Start

```bash
npx nuxi module add nuxt-safe-runtime-config
```

```ts [nuxt.config.ts]
import { number, object, optional, string } from 'valibot'

const schema = object({
  public: object({ apiBase: string() }),
  databaseUrl: string(),
  port: optional(number()),
})

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    port: Number.parseInt(process.env.PORT || '3000'),
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: { $schema: schema },
})
```

```vue
<script setup lang="ts">
const config = useSafeRuntimeConfig()
// config.public.apiBase - string (typed)
</script>
```

## Documentation

Full documentation at **[nuxt-safe-runtime-config.vercel.app](https://nuxt-safe-runtime-config.vercel.app)**

## License

MIT
