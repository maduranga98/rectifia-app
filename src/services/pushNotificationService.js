import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { env } from '../config/env'

const registerPushSubscriptionCallable = httpsCallable(functions, 'registerPushSubscription')

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

// Subscribes this device to push notifications for one case, anonymously.
// The subscription is keyed only by Case ID on the server
// (pushSubscriptions/{caseId} - see functions/src/notifications/
// sendCaseUpdate.js) - no name, email, or device identity is ever attached,
// and the Case ID + passcode are re-verified server-side before the
// subscription is stored, same as every other reporter action in this app.
export async function subscribeToCaseUpdates(caseId, passcode) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser')
  }
  if (!env.vapidPublicKey) {
    throw new Error('Push notifications are not configured')
  }

  const registration = await navigator.serviceWorker.ready
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
