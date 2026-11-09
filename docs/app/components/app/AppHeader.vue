<script setup lang="ts">
import DocusHeader from 'docus/app/components/app/AppHeader.vue'
</script>

<template>
  <UBanner
    id="nuxt-5-native-schemas"
    icon="i-ph-number-circle-five"
    title="On Nuxt 5? Nuxt now types runtime config from your schema, and the module adds the checks it skips."
    to="/guide/nuxt-5"
    :actions="[{ label: 'Nuxt 5 guide', to: '/guide/nuxt-5', color: 'neutral', variant: 'outline', trailingIcon: 'i-ph-arrow-right' }]"
    close
  />
  <DocusHeader />
</template>
