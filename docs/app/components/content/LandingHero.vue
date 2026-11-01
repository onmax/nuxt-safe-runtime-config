<script setup lang="ts">
const still = ref(false)
onMounted(() => {
  still.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
</script>

<template>
  <section class="relative isolate overflow-hidden bg-[#020420] text-white">
    <ClientOnly>
      <LandingFaultyTerminal
        class="absolute! inset-0 -z-20 opacity-70"
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
    <div class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_50%_42%,#020420_15%,rgb(2_4_32/0.75)_55%,transparent_100%)]" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-b from-transparent to-(--ui-bg)" />

    <div class="mx-auto flex max-w-5xl flex-col items-center px-6 pt-28 pb-24 text-center sm:pt-36">
      <span class="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-xs text-white/70 backdrop-blur">
        Nuxt 4 and 5 · Valibot, Zod, ArkType
      </span>

      <h1 class="mt-8 text-5xl font-bold tracking-tight text-balance sm:text-7xl">
        Runtime config
        <br>
        <span v-if="still" class="text-[#00DC82]">you can trust.</span>
        <LandingDecryptedText
          v-else
          text="you can trust."
          animate-on="view"
          sequential
          :speed="45"
          characters="ABCDEF0123456789{}[]$_"
          :class-name="'text-[#00DC82]'"
          :encrypted-class-name="'text-[#00DC82]/40'"
        />
      </h1>

      <p class="mt-6 max-w-2xl text-lg text-pretty text-white/70">
        A missing secret or a malformed <code class="font-mono text-white/90">NUXT_*</code> flag fails the build or the server start. <code class="font-mono text-white/90">useSafeRuntimeConfig()</code> returns the values typed from your schema.
      </p>

      <div class="mt-10 flex flex-wrap justify-center gap-3">
        <UButton to="/guide" size="xl" icon="i-ph-rocket-launch" label="Get started" />
        <UButton
          to="https://github.com/onmax/nuxt-safe-runtime-config"
          size="xl"
          color="neutral"
          variant="ghost"
          icon="i-simple-icons-github"
          label="GitHub"
          class="text-white ring ring-inset ring-white/25 hover:bg-white/10"
        />
      </div>

      <div class="mt-16 w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-[#090b20]/85 text-left shadow-2xl shadow-black/50 backdrop-blur">
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
