// ViteHub Hosted Comments: open a page with ?vitehub to comment. Threads live in the ViteHub Console.
// Nuxt hides the URL hash while it hydrates a prerendered page, and the embed reads its `#vhc` sign-in code once.
export default defineNuxtPlugin(() => {
  const router = useRouter()
  onNuxtReady(() => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = 'https://console.vitehub.dev/hosted-comments.js'
    script.dataset.vitehubComments = '8ade2dbb-5d68-45c3-8df2-16618bd90fea'
    if (router.currentRoute.value.hash.includes('vhc=')) {
      const loaded = new Promise((resolve) => {
        script.onload = script.onerror = resolve
      })
      // A navigation before the embed runs would lose the code, and one after it would write the code back into history.
      const removeGuard = router.beforeEach(() => loaded.then(() => {}))
      loaded.then(() => {
        removeGuard()
        if (!location.hash.includes('vhc='))
          router.options.history.replace(location.pathname + location.search + location.hash)
      })
    }
    document.head.append(script)
  })
})
