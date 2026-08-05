import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { env } from '../config/env'

const registerPushSubscriptionCallable = httpsCallable(functions, 'registerPushSubscription')
const unregisterPushSubscriptionCallable = httpsCallable(functions, 'unregisterPushSubscription')

const SERVICE_WORKER_READY_TIMEOUT_MS = 10000

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

// navigator.serviceWorker.ready never rejects. If registration failed
// (missing sw.js, blocked by policy, private-window quirk on Firefox),
// awaiting it just hangs forever. A reporter clicking "Enable" deserves
// a clear failure, not an eternal spinner, so we race it against a
// timeout and translate that into a "push is not available" error.
async function readyOrTimeout() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Push notifications are not available on this device')
  }
  const ready = navigator.serviceWorker.ready
  const timeout = new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error('Push notifications are not available on this device')),
      SERVICE_WORKER_READY_TIMEOUT_MS
    )
  })
  return Promise.race([ready, timeout])
}

// Subscribes this device to push notifications for one case, anonymously.
// The subscription is keyed only by Case ID on the server
// (pushSubscriptions/{caseId} - see functions/src/notifications/
// sendCaseUpdate.js) - no name, email, or device identity is ever attached,
// and the Case ID + passcode are re-verified server-side before the
// subscription is stored, same as every other reporter action in this app.
export async function subscribeToCaseUpdates(caseId, passcode) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push notifications are not supported in this browser')
  }
  if (!env.vapidPublicKey) {
    throw new Error('Push notifications are not configured')
  }

  // Safari does not prompt implicitly from pushManager.subscribe(); it
  // requires Notification.requestPermission() to be called in the same
  // user-gesture chain that triggered this function. Chrome accepts either,
  // so calling it explicitly is safe on both.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    const err = new Error('Notification permission was not granted')
    err.code = 'permission-denied'
    err.permission = permission
    throw err
  }

  const registration = await readyOrTimeout()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
  })

  await registerPushSubscriptionCallable({
    caseId,
    passcode,
    subscription: subscription.toJSON(),
  })

  return subscription
}

// Turns off case notifications for this device. Removes the browser
// subscription and asks the server to drop the pushSubscriptions/{caseId}
// doc so no further pushes are sent. A reporter who enabled notifications
// on a shared or work device needs this to be one click, on the same screen.
export async function unsubscribeFromCaseUpdates(caseId, passcode) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return
  }

  let registration = null
  try {
    registration = await readyOrTimeout()
  } catch {
    // No worker means no local subscription to remove; still ask the server
    // to drop the doc so future pushes stop.
  }

  if (registration) {
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      try {
        await subscription.unsubscribe()
      } catch (err) {
        console.warn('[push] browser unsubscribe failed', err)
      }
    }
  }

  await unregisterPushSubscriptionCallable({ caseId, passcode })
}
