<script setup lang="ts">
import { computed } from 'vue'

const config = useRuntimeConfig()
const methods = computed(() => config.public.loginMethods)
</script>

<template>
  <button v-for="method in methods" :key="method">
    {{ method }}
  </button>
</template>
