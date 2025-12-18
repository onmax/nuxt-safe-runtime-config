<script setup>
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>
    <h1>Valibot Runtime Test</h1>
    <pre>{{ JSON.stringify(config.public, null, 2) }}</pre>
  </div>
</template>
