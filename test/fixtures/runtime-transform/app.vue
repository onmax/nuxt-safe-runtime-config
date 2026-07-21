<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>{{ typeof config.public.featureEnabled }}</div>
</template>
