<script setup lang="ts">
import DocusHeader from 'docus/app/components/app/AppHeader.vue'
</script>

<template>
  <UBanner
    id="deprecated"
    icon="i-ph-warning"
    color="warning"
    to="/"
    :actions="[{ label: 'Migration guide', to: '/', color: 'neutral', variant: 'outline', trailingIcon: 'i-ph-arrow-right' }]"
  >
    <template #title>
      Deprecated: Nuxt 4.7 checks runtimeConfig schemas itself. Migrate with <code class="font-mono">npx nuxt-safe-runtime-config@latest migrate</code>
    </template>
  </UBanner>
  <DocusHeader />
</template>
