<script setup lang="ts">
const appConfig = useAppConfig()
</script>

<template>
  <span class="flex items-center gap-2 font-semibold text-highlighted">
    <img src="/icon.svg" alt="" class="size-6 shrink-0">
    <span>{{ appConfig.header?.title }}</span>
  </span>
</template>
