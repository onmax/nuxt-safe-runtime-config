<script setup>
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>
    <h1>Nuxt module playground!</h1>
    <pre>{{ JSON.stringify(config.public, null, 2) }}</pre>
  </div>
</template>
