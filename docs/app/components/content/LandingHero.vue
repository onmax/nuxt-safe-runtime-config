<script setup lang="ts">
const still = ref(false)
onMounted(() => {
  still.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
</script>

<template>
  <section class="relative isolate overflow-hidden bg-default text-highlighted">
    <ClientOnly>
      <LandingFaultyTerminal
        class="absolute! inset-0 -z-20 opacity-90 mix-blend-multiply invert hue-rotate-180 dark:opacity-70 dark:mix-blend-screen dark:invert-0 dark:hue-rotate-0"
        tint="#00DC82"
        :scale="1.6"
        :grid-mul="[2, 1]"
        :digit-size="1.3"
        :time-scale="0.4"
        :scanline-intensity="0.4"
        :glitch-amount="1"
        :flicker-amount="1"
        :noise-amp="0.8"
        :curvature="0.15"
        :brightness="0.5"
        :mouse-react="!still"
        :mouse-strength="0.3"
        :page-load-animation="!still"
        :pause="still"
      />
    </ClientOnly>
    <div class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_50%_42%,var(--ui-bg)_15%,color-mix(in_oklab,var(--ui-bg)_75%,transparent)_55%,transparent_100%)]" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-b from-transparent to-(--ui-bg)" />

    <div class="mx-auto flex max-w-5xl flex-col items-center px-6 pt-28 pb-24 text-center sm:pt-36">
      <span class="rounded-full border border-default bg-elevated/60 px-3 py-1 font-mono text-xs text-muted backdrop-blur">
        Nuxt 4 and 5 · Valibot, Zod, ArkType
      </span>

      <h1 class="mt-8 text-5xl font-bold tracking-tight text-balance sm:text-7xl">
        Runtime config
        <br>
        <span v-if="still" class="text-primary">you can trust.</span>
        <LandingDecryptedText
          v-else
          text="you can trust."
          animate-on="view"
          sequential
          :speed="45"
          characters="ABCDEF0123456789{}[]$_"
          :class-name="'text-primary'"
          :encrypted-class-name="'text-primary/40'"
        />
      </h1>

      <p class="mt-6 max-w-2xl text-lg text-pretty text-muted">
        A missing secret or a malformed <code class="font-mono text-highlighted">NUXT_*</code> flag fails the build or the server start. <code class="font-mono text-highlighted">useSafeRuntimeConfig()</code> returns the values typed from your schema.
      </p>

      <div class="mt-10 flex flex-wrap justify-center gap-3">
        <UButton to="/guide" size="xl" icon="i-ph-rocket-launch" label="Get started" />
        <UButton
          to="https://github.com/onmax/nuxt-safe-runtime-config"
          size="xl"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          label="GitHub"
        />
      </div>

      <div class="mt-16 w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-[#090b20] text-left dark:bg-[#090b20]/85 shadow-2xl shadow-black/20 backdrop-blur dark:shadow-black/50">
        <div class="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-xs text-white/40">
          <span class="size-2.5 rounded-full bg-red-500" />
          <span class="size-2.5 rounded-full bg-yellow-500" />
          <span class="size-2.5 rounded-full bg-green-500" />
          <span class="ml-2">~/your-app</span>
        </div>
        <pre class="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-white/90 sm:text-sm"><span class="text-[#00DC82]">$</span> nuxt build
<span class="text-red-400">ERROR</span>  <span class="text-white/40">[safe-runtime-config]</span> Validation failed!
  <span class="text-yellow-400">1.</span> databaseUrl: <span class="text-white/50">Invalid key: Expected "databaseUrl" but received undefined</span>
  <span class="text-yellow-400">2.</span> public.apiBase: <span class="text-white/50">Invalid URL: Received "not a url"</span></pre>
      </div>
    </div>
  </section>
</template>
