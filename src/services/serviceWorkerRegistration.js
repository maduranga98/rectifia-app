// Service worker lifecycle for the reporter-facing PWA. The worker itself
// (public/sw.js) handles only push and notification clicks - no fetch, no
// caches. Registration failure here is non-fatal: push simply becomes
// unavailable and CaseNotificationOptIn handles that state gracefully.

let registrationPromise = null
const relayListeners = new Set()

export async function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  if (registrationPromise) {
    return registrationPromise
  }

  registrationPromise = navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .catch((err) => {
      // Log and swallow. A registration failure must never break the app;
      // it only means push notifications won't work on this device.
      console.warn('[sw] registration failed', err)
      registrationPromise = null
      return null
    })

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'pushsubscriptionchange') {
      for (const listener of relayListeners) {
        try {
          listener()
        } catch (err) {
          console.warn('[sw] relay listener failed', err)
        }
      }
    }
  })

  return registrationPromise
}

// The worker posts a 'pushsubscriptionchange' message when the browser
// silently rotates a subscription. A view that currently holds Case ID +
// passcode can subscribe here to re-run subscribeToCaseUpdates; a view
// without credentials just ignores the event.
export function onPushSubscriptionChange(listener) {
  relayListeners.add(listener)
  return () => {
    relayListeners.delete(listener)
  }
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  const mm = window.matchMedia && window.matchMedia('(display-mode: standalone)')
  if (mm && mm.matches) return true
  // iOS reports installed-to-Home-Screen via navigator.standalone rather
  // than the display-mode media query.
  return navigator.standalone === true
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports as Mac; distinguish by touch support.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}
