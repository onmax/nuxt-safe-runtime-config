<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>

<template>
  <main>
    <h1>{{ config.public.displayLabel }}</h1>
    <p>replay:{{ typeof config.public.replayEnabled }}:{{ config.public.replayEnabled }}</p>
    <p>sample:{{ typeof config.public.telemetry.sampleRate }}:{{ config.public.telemetry.sampleRate }}</p>
    <p>level:{{ config.public.logLevel }}</p>
    <p>api:{{ config.public.apiBase }}</p>
  </main>
</template>
