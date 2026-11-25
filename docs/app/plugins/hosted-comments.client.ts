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
      let cleanedPath: string | undefined
      // The embed clears `#vhc` without Vue Router, and the next navigation would write it back into history.
      // Only the history entry is cleaned: a navigation here would cancel a held click or scroll the page.
      loaded.then(() => {
        if (router.currentRoute.value.hash.includes('vhc=') && !location.hash.includes('vhc=')) {
          cleanedPath = location.pathname + location.search + location.hash
          router.options.history.replace(cleanedPath)
        }
      })
      // A navigation before the embed runs would lose the code. A stalled Console request holds links for 5 s, no more.
      const released = Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 5000))])
      const removeGuard = router.beforeEach(async (to, from) => {
        if (!from.hash.includes('vhc='))
          return removeGuard()
        await released
        // The cleaned URL is already displayed. Ignore duplicate clicks without redirecting over a newer navigation.
        if (to.fullPath === cleanedPath && to.fullPath === location.pathname + location.search + location.hash)
          return false
      })
      // The browser follows a heading permalink without Vue Router, so send it through the guard.
      const holdAnchor = (event: MouseEvent) => {
        const anchor = (event.target as Element).closest('a[href^="#"]')
        if (!anchor || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return
        event.preventDefault()
        router.push(location.pathname + location.search + anchor.getAttribute('href'))
      }
      document.addEventListener('click', holdAnchor, true)
      released.then(() => document.removeEventListener('click', holdAnchor, true))
    }
    document.head.append(script)
  })
})
