# Security policy

## Maintenance mode

nuxt-safe-runtime-config is in maintenance mode. It gets security fixes and fixes for severe bugs only. No new features will be added.

Nuxt 4.7 adds [native runtime config schema validation](https://nuxt.com/docs/4.x/guide/going-further/runtime-config#validating-with-a-schema). New projects can use it when its checks are sufficient. To migrate an existing Nuxt app:

1. Check what your app relies on. Nuxt does not enforce URL formats, ranges, patterns, or custom refinements, and it does not apply schema transforms. Keep the module if you need that behavior, or add equivalent checks and transforms to your app before removing it.
2. Upgrade to Nuxt 4.7 or later and follow Nuxt's guide to declare your schema in `runtimeConfig`. Preserve your defaults, `public` keys, and `NUXT_*` overrides.
3. Replace `useSafeRuntimeConfig()` calls and imports with Nuxt's `useRuntimeConfig()`. Remove the module from `modules`, delete `safeRuntimeConfig`, and uninstall the package. Verify that the built server starts with valid environment values and rejects invalid ones as expected.

## Supported versions

Only the latest release line gets security fixes: 0.x until 1.0.0 ships, then 1.x. Upgrade to the latest release before reporting.

## Reporting a vulnerability

Please don't open a public issue. Report it privately from the [Security tab](https://github.com/onmax/nuxt-safe-runtime-config/security/advisories/new) of this repository with GitHub's private vulnerability reporting. Include the version you use, the steps to reproduce, and the impact you expect.
