---
title: Nuxt Safe Runtime Config
description: Validate Nuxt runtime config with Valibot, Zod, ArkType or an annotated .env.example, and read it through a typed composable.
navigation: false
---

::landing-hero
::

::u-page-section
---
title: One schema, checked where your values come from
description: Write the schema once. The module checks it against nuxt.config.ts at build, or against the NUXT_* variables the server starts with, and types useSafeRuntimeConfig() from it.
---

#features
  :::u-page-feature
  ---
  icon: i-ph-hammer
  title: At build
  to: /guide/validation#at-build
  ---
  `nuxt build` stops when a value in `nuxt.config.ts` is missing or malformed.
  :::

  :::u-page-feature
  ---
  icon: i-ph-cloud-check
  title: At runtime
  to: /guide/validation#at-server-start
  ---
  With `validateAtRuntime`, invalid `NUXT_*` values stop startup with synchronous schemas or fail requests with asynchronous schemas.
  :::

  :::u-page-feature
  ---
  icon: i-ph-arrows-left-right
  title: NUXT_* strings converted
  to: /guide/environment-overrides
  ---
  `NUXT_FLAG=false` becomes `false` and `NUXT_RATE=0.5` becomes `0.5` when the schema asks for them.
  :::

  :::u-page-feature
  ---
  icon: i-ph-shield-check
  title: Typed from the schema
  to: /guide/type-safety
  ---
  `useSafeRuntimeConfig()` has your schema's types in pages, plugins and server routes.
  :::

  :::u-page-feature
  ---
  icon: i-ph-file-text
  title: .env.example as schema
  to: /guide/env-schema
  ---
  Add `@type` comments to the file you already commit, and build without secrets.
  :::

  :::u-page-feature
  ---
  icon: simple-icons:eslint
  title: One-command migration
  to: /guide/eslint
  ---
  `eslint --fix` rewrites every `useRuntimeConfig()` call to `useSafeRuntimeConfig()`.
  :::
::
