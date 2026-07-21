<script setup lang="ts">
const config = useSafeRuntimeConfig()
const runtimeConfig = useRuntimeConfig()
</script>

<template>
  <div>{{ typeof config.public.featureEnabled }}</div>
  <div>moduleConfig:{{ runtimeConfig.public.moduleConfig.label }}:{{ runtimeConfig.public.moduleConfig.nested.count }}</div>
</template>
