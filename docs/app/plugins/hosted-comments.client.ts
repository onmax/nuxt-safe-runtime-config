// ViteHub Hosted Comments: open a page with ?vitehub to comment. Threads live in the ViteHub Console.
// Nuxt hides the URL hash while it hydrates a prerendered page, and the embed reads its `#vhc` sign-in code once.
export default defineNuxtPlugin(() => {
  const router = useRouter()
  onNuxtReady(() => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = 'https://console.vitehub.dev/hosted-comments.js'
    script.dataset.vitehubComments = '8ade2dbb-5d68-45c3-8df2-16618bd90fea'
    // The embed removes `#vhc` with history.replaceState. Without this, the router writes the code back on the next navigation.
    script.addEventListener('load', () => {
      if (router.currentRoute.value.hash.includes('vhc=') && !location.hash.includes('vhc='))
        router.replace(location.pathname + location.search + location.hash)
    })
    document.head.append(script)
  })
})
