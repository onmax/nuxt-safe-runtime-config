<script setup lang="ts">
import DocusHeader from 'docus/app/components/app/AppHeader.vue'
</script>

<template>
  <UBanner
    id="vitehub-env-nuxt-5"
    icon="i-ph-arrow-circle-up-right"
    title="On Nuxt 5? Move to @vite-hub/env with one command."
    to="/guide/migrate-to-vitehub-env"
    :actions="[{ label: 'Migration guide', to: '/guide/migrate-to-vitehub-env', color: 'neutral', variant: 'outline', trailingIcon: 'i-ph-arrow-right' }]"
    close
  />
  <DocusHeader />
</template>
