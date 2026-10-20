<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>posthog:{{ typeof config.public.posthog.enabled }}:{{ config.public.posthog.enabled }}</div>
  <div>rate:{{ typeof config.public.posthog.sampleRate }}</div>
</template>
