<script setup lang="ts">
const config = useSafeRuntimeConfig()
</script>

<template>
  <div>{{ config.public.apiBase }}</div>
</template>
