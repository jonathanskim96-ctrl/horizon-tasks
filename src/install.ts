// "Install app" support. Chromium browsers fire `beforeinstallprompt`, which we
// keep so a button can show the real install dialog later. iOS Safari has no
// such API, so there we show the Share → Add to Home Screen steps instead.
import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own button instead of the mini-infobar
    deferred = e as InstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unavailable'

export function useInstall(): { mode: InstallMode; install: () => Promise<void> } {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    const mq = window.matchMedia?.('(display-mode: standalone)')
    mq?.addEventListener?.('change', l)
    return () => {
      listeners.delete(l)
      mq?.removeEventListener?.('change', l)
    }
  }, [])
  const mode: InstallMode = isStandalone() ? 'installed' : deferred ? 'prompt' : isIOS() ? 'ios' : 'unavailable'
  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null
    listeners.forEach((l) => l())
  }
  return { mode, install }
}
