import { useEffect, useRef, useState } from 'react'
import {
  subscribeToCaseUpdates,
  unsubscribeFromCaseUpdates,
} from '../../services/pushNotificationService'
import {
  isIOS,
  isStandalone,
  onPushSubscriptionChange,
} from '../../services/serviceWorkerRegistration'
import { env } from '../../config/env'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// The reporter-facing opt-in for case-thread push notifications. It is offered
// twice - once on the post-submission screen, and persistently at the foot of
// the case thread for anyone who declined the first time or later cleared the
// permission - so this component owns the whole decision, including the states
// where there is nothing to click.
//
// The subscription is anonymous and keyed only by Case ID (registerPushSubscription
// stores it at pushSubscriptions/{caseId}); the passcode is passed solely so the
// server can re-verify the reporter, exactly as every other reporter action does,
// and nothing else - no name, email, phone, or device identity - is ever attached.
//
// The privacy promise the reporter is consenting to is that the notification
// carries no case details at all: the decoy-template rotation guarantees that
// server-side, but a reporter has to know it holds before they agree, so the
// "no details" line is shown in every state that leads to a subscription.
function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(env.vapidPublicKey)
  )
}

function NoDetailsNote() {
  return (
    <p className="text-xs text-muted">
      A notification never contains any detail about your case — no message text, no category,
      nothing that could identify the report. It only tells you there is an update to come back
      and read here.
    </p>
  )
}

function CaseNotificationOptIn({ caseId, passcode, className = '' }) {
  const supported = pushSupported()
  // Read the live browser permission up front. It is global to the site, not to
  // this case, so 'granted' does not mean this case is subscribed yet - it only
  // means enabling it will not need a prompt.
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : 'unsupported'
  )
  const [status, setStatus] = useState('idle') // idle | working | done | error
  const [error, setError] = useState(null)
  const [disableStatus, setDisableStatus] = useState('idle') // idle | working | done | error
  const [disableError, setDisableError] = useState(null)

  // Browsers silently rotate push subscriptions; the service worker relays
  // that event as a message and we re-register here because this view still
  // holds the credentials the server needs to verify the reporter. If the
  // reporter hasn't opted in yet on this device, do nothing - a rotation on
  // a subscription that doesn't exist is a no-op.
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])
  useEffect(() => {
    if (!supported || !caseId || !passcode) return undefined
    return onPushSubscriptionChange(() => {
      if (statusRef.current !== 'done') return
      subscribeToCaseUpdates(caseId, passcode).catch((err) => {
        console.warn('[push] re-subscribe after rotation failed', err)
      })
    })
  }, [supported, caseId, passcode])

  async function enable() {
    setStatus('working')
    setError(null)
    try {
      await subscribeToCaseUpdates(caseId, passcode)
      setPermission('granted')
      setStatus('done')
    } catch (err) {
      // A reporter who dismisses or blocks the browser prompt lands here. Read
      // the permission back live: if they blocked it, drop into the "denied"
      // guidance rather than showing a generic failure they can only retry into
      // the same wall.
      const live = 'Notification' in window ? Notification.permission : 'default'
      setPermission(live)
      if (live === 'denied') {
        setStatus('idle')
      } else {
        setStatus('error')
        setError(err.message)
      }
    }
  }

  async function disable() {
    setDisableStatus('working')
    setDisableError(null)
    try {
      await unsubscribeFromCaseUpdates(caseId, passcode)
      setDisableStatus('done')
      setStatus('idle')
    } catch (err) {
      setDisableStatus('error')
      setDisableError(err.message)
    }
  }

  const wrapper = `flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 ${className}`

  // iOS gate: Web Push on Safari requires the app to be installed to the Home
  // Screen first. pushManager.subscribe() throws in mobile Safari otherwise,
  // and no amount of retrying fixes it. Show install instructions instead of a
  // broken Enable button. This runs before the generic `supported` check
  // because Safari does expose the APIs - it just refuses to use them until
  // installed.
  if (isIOS() && !isStandalone()) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="mail" className="h-4 w-4 text-muted" />
          Get notified when there&apos;s a reply
        </p>
        <p className="text-sm text-muted">
          On iPhone and iPad, notifications only work once this site is added to your Home Screen.
          Tap the Share button in Safari, choose <strong>Add to Home Screen</strong>, then open
          Rectifia from your home screen and come back to this page to turn them on.
        </p>
        <NoDetailsNote />
      </div>
    )
  }

  // Unsupported: no service worker, push API, Notification API, or configured
  // key. Say so plainly and point back to the manual route - never a dead button.
  if (!supported) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="mail" className="h-4 w-4 text-muted" />
          Notifications aren&apos;t available in this browser
        </p>
        <p className="text-xs text-muted">
          This browser can&apos;t send you case updates. You can still come back any time with your
          Case ID and passcode to read replies.
        </p>
      </div>
    )
  }

  // Blocked at the browser level. A button here would silently do nothing, so
  // instead tell the reporter exactly how to reverse it themselves.
  if (permission === 'denied') {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="mail" className="h-4 w-4 text-muted" />
          Notifications are blocked for this site
        </p>
        <p className="text-xs text-muted">
          Your browser is set to block notifications here, so we can&apos;t turn them on from this
          page. To allow them, open this site&apos;s permissions — usually the icon at the left of
          the address bar, or Settings → Site settings → Notifications — set notifications to Allow,
          then reload this page.
        </p>
        <NoDetailsNote />
      </div>
    )
  }

  if (status === 'done') {
    // Subscribed state. Always offer a one-click "turn off" here: a reporter
    // who enabled notifications on a shared or work device needs to be able
    // to undo that from the same screen they enabled it on.
    return (
      <div className={wrapper}>
        <Alert variant="success" title="You'll be notified of replies">
          This device will get a notification when there&apos;s a reply on your case. It won&apos;t
          say anything about the case itself — just that there&apos;s an update to check.
        </Alert>
        {disableStatus === 'done' ? (
          <Alert variant="info">
            Notifications are off for this device. Reopen this page any time to turn them back on.
          </Alert>
        ) : (
          <>
            <p className="text-xs text-muted">
              On a shared or work device, turn notifications off before you leave — otherwise the
              next person using this browser will see the update prompts.
            </p>
            {disableStatus === 'error' && disableError && (
              <Alert variant="error">{disableError}</Alert>
            )}
            <div>
              <Button
                variant="ghost"
                onClick={disable}
                loading={disableStatus === 'working'}
                loadingLabel="Turning off"
              >
                Turn off on this device
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Actionable: permission is 'default' (will prompt) or 'granted' (won't).
  return (
    <div className={wrapper}>
      <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
        <Icon name="mail" className="h-4 w-4 text-muted" />
        Get notified when there&apos;s a reply
      </p>
      <p className="text-sm text-muted">
        Turn on notifications on this device so you know when your handler responds, without having
        to keep checking back.
      </p>
      <NoDetailsNote />
      {status === 'error' && error && <Alert variant="error">{error}</Alert>}
      <div>
        <Button
          variant="primary"
          icon="mail"
          onClick={enable}
          loading={status === 'working'}
          loadingLabel="Turning on"
        >
          {permission === 'granted' ? 'Turn on reply notifications' : 'Notify me of replies'}
        </Button>
      </div>
    </div>
  )
}

export default CaseNotificationOptIn
