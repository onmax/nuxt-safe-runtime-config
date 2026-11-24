<script setup lang="ts">
const config = useSafeRuntimeConfig()
const apiBase = useSafeRuntimeConfig().public.apiBase
</script>

<template>
  <div>{{ config.public.apiBase }} {{ apiBase }}</div>
</template>
