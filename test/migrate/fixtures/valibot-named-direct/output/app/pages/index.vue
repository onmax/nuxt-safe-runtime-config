<script setup lang="ts">
const config = useRuntimeConfig()
const apiBase = useRuntimeConfig().public.apiBase
</script>

<template>
  <div>{{ config.public.apiBase }} {{ apiBase }}</div>
</template>
