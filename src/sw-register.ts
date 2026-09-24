// Service worker registration with dependable updates.
// A new version installs in the background and takes over immediately
// (skipWaiting + clientsClaim). The open page is still the old code, so:
//  - if the takeover happens right after opening (before any real use), reload;
//  - otherwise announce it, and the app shows a "Reload" banner (never
//    reloading mid-edit).
// Updates are also checked every time the app comes back into view.
export const UPDATE_EVENT = 'horizon:update-ready'
const RELOAD_WINDOW_MS = 10_000

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  const hadController = !!navigator.serviceWorker.controller
  const openedAt = Date.now()
  let handled = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || handled) return // first install: this page is already current
    handled = true
    if (Date.now() - openedAt < RELOAD_WINDOW_MS && !sessionStorage.getItem('horizon-reloaded')) {
      sessionStorage.setItem('horizon-reloaded', '1') // never loop
      window.location.reload()
    } else {
      window.dispatchEvent(new Event(UPDATE_EVENT))
    }
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        if (!reg) return // some browsers/privacy modes register nothing
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => {
        /* no offline support in this browser; the app still works online */
      })
  })
}
