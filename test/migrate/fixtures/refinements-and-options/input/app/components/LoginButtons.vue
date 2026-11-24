<script setup lang="ts">
import { computed } from 'vue'

const config = useSafeRuntimeConfig()
const methods = computed(() => config.public.loginMethods)
</script>

<template>
  <!-- eslint-disable-next-line safe-runtime-config/prefer-safe-runtime-config -->
  <button v-for="method in methods" :key="method">
    {{ method }}
  </button>
</template>
