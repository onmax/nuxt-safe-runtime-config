import type { RouterConfig } from '@nuxt/schema'

export default <RouterConfig>{
  routes: routes => routes.filter(route => !route.path.startsWith('/blog')),
}
