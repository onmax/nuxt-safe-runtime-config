<script setup>
// This will throw because NUXT_SECRET_KEY env var will be "short"
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>
    <h1>Runtime Invalid Test</h1>
    <pre>{{ JSON.stringify(config.public, null, 2) }}</pre>
  </div>
</template>
