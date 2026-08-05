// Rectifia service worker. Push and notification-click only. No fetch handler,
// no caches API, no offline shell. The security model here is that a device
// someone else might pick up must not carry a copy of any case narrative,
// evidence URL, or thread message. A precache or runtime cache would break
// that guarantee; we hand-write this worker and keep it small on purpose.
//
// The payload arriving at 'push' is already anonymized server-side (see
// functions/src/notifications/decoyTemplates.js and sendCaseUpdate.js): the
// title, body and tag are pulled from a rotating decoy pool that never
// mentions "case", "report", the category, or any Case ID. This worker
// displays exactly what the server sent and adds nothing of its own.

const FALLBACK = {
  title: 'You have an update',
  body: 'There is a new update waiting for you.',
  tag: 'rectifia-update',
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = FALLBACK
  if (event.data) {
    try {
      const parsed = event.data.json()
      if (parsed && parsed.title && parsed.body && parsed.tag) {
        payload = { title: parsed.title, body: parsed.body, tag: parsed.tag }
      }
    } catch {
      // Fall through to FALLBACK. The server always sends JSON with the
      // three expected fields; anything else is treated as a delivery
      // glitch and shown as the first generic decoy line.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: false,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // Root only. A /case/:caseId deep link in the notification, browser history,
  // or a shoulder-surfed address bar would reintroduce exactly what the decoy
  // templates remove. The reporter reopens their case with the credentials
  // they already hold.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/')
      }
      return undefined
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  // Browsers silently rotate subscriptions. Relay to any open client so the
  // app can re-register when it next has credentials in hand. Calling the
  // Cloud Function from here is deliberately not attempted - the worker
  // holds no passcode and registerPushSubscription refuses callers without
  // one.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: 'pushsubscriptionchange' })
      }
    })
  )
})
