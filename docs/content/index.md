---
title: Nuxt Safe Runtime Config
description: Validate Nuxt runtime config with Valibot, Zod, ArkType or an annotated .env.example, and read it through a typed composable.
navigation: false
---

::u-page-hero
---
title: Runtime config you can trust
description: Validate Nuxt runtime config with Valibot, Zod, ArkType or an annotated .env.example. A missing secret or a malformed flag fails the build or the server start, and useSafeRuntimeConfig() returns typed values.
links:
  - label: Get started
    to: /guide
    icon: i-ph-rocket-launch
    size: xl
  - label: GitHub
    to: https://github.com/onmax/nuxt-safe-runtime-config
    icon: i-simple-icons-github
    color: neutral
    variant: outline
    size: xl
---

#headline
:u-badge{label="Nuxt 4 and 5" variant="subtle"}
::

::u-page-section
---
title: What it checks
---

#features
  :::u-page-feature
  ---
  icon: i-ph-hammer
  title: Build validation
  to: /guide/validation
  ---
  Checks the values in `nuxt.config.ts` during `nuxt dev` and `nuxt build`.
  :::

  :::u-page-feature
  ---
  icon: i-ph-cloud-check
  title: Runtime validation
  to: /guide/validation
  ---
  Checks the values the deployed server starts with, after `NUXT_*` overrides.
  :::

  :::u-page-feature
  ---
  icon: i-ph-arrows-left-right
  title: Environment coercion
  to: /guide/environment-overrides
  ---
  Turns `NUXT_FLAG=true` into `true` and `NUXT_RATE=0.5` into `0.5` when the schema asks for them.
  :::

  :::u-page-feature
  ---
  icon: i-ph-shield-check
  title: Generated types
  to: /guide/type-safety
  ---
  `useSafeRuntimeConfig()` is typed from your schema in pages, plugins and server routes.
  :::

  :::u-page-feature
  ---
  icon: i-ph-file-text
  title: .env.example as schema
  to: /guide/env-schema
  ---
  Annotate a committed `.env.example` and build without deployment secrets.
  :::

  :::u-page-feature
  ---
  icon: simple-icons:eslint
  title: ESLint rule
  to: /integrations/eslint
  ---
  Flags `useRuntimeConfig()` calls and fixes them to `useSafeRuntimeConfig()`.
  :::
::
