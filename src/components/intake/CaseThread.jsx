import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addManualLogEntry,
  getCaseThread,
  getCaseThreadForHandler,
  getEvidenceDownloadUrl,
  sendInvestigatorMessage,
  sendReporterMessage,
  translateMessage,
  uploadCaseEvidence,
} from '../../services/caseThreadService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import CaseNotificationOptIn from './CaseNotificationOptIn'
import CrisisResources from '../shared/CrisisResources'
import EmptyState from '../ui/EmptyState'
import FollowUpPrompt from './FollowUpPrompt'
import Icon from '../ui/Icon'

const POLL_INTERVAL_MS = 8000

function formatTimestamp(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString()
}

function messageAuthorLabel(message, t) {
  if (message.type === 'manual_log') return t('caseThread.authors.investigatorLog')
  if (message.sender === 'ai') return t('caseThread.authors.aiAssistant')
  if (message.sender === 'investigator') return t('caseThread.authors.caseHandler')
  // Written only server-side, and only by
  // functions/src/intake/identityTransition.js: a note that the reporter
  // identified themselves, or added or removed a contact address. It carries
  // no identity content, and both the reporter and the handler see the same
  // text - the change is meant to be legible in the timeline, which is
  // different from being explained to one side.
  if (message.sender === 'system') return t('caseThread.authors.caseRecord')
  return t('caseThread.authors.reporter')
}

// Bubble treatment per author. "Mine" (whoever is reading) sits on the
// right in navy; everyone else is a light bubble on the left, and a manual
// log entry is amber and full-width because it is a record rather than a
// message to anyone.
function bubbleClasses(message, mine) {
  if (message.type === 'manual_log') return 'tone-high border w-full'
  // Full-width and neutral, like a manual log entry: a record of something that
  // happened to the case, not a message from anyone to anyone.
  if (message.sender === 'system') return 'border border-line bg-canvas text-muted w-full'
  if (mine) return 'bg-navy text-white border border-navy'
  if (message.sender === 'ai') return 'border border-navy-200 bg-navy-50 text-charcoal'
  return 'border border-line bg-surface text-charcoal'
}

function formatSize(bytes) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// An attachment row. There is no stored URL to link to any more - the message
// document holds only { fileName, label, contentType, sizeBytes } - so opening
// one asks the server for a signed URL that lives about 15 minutes, and that
// URL is used immediately and never kept. Rendering a link would mean minting
// a credential for every attachment on screen whether or not anyone opens it.
//
// The anchor is created and clicked rather than window.open'd because the
// signed URL only exists after an await, and a popup blocker will stop an
// async window.open that is no longer attributable to the click.
function AttachmentLink({ caseId, mode, passcode, attachment, tone }) {
  const { t } = useTranslation()
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  async function open() {
    setOpening(true)
    setFailed(false)
    try {
      // A handler has no passcode - requestEvidenceDownloadUrl authorises
      // an investigator by their Firebase Auth identity instead (see
      // evidenceAccess.js's authorizeCaseAccess), so the passcode is
      // deliberately omitted rather than passed as undefined.
      const url =
        mode === 'investigator'
          ? await getEvidenceDownloadUrl(caseId, attachment.fileName)
          : await getEvidenceDownloadUrl(caseId, attachment.fileName, passcode)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.click()
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }

  const size = formatSize(attachment.sizeBytes)

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={opening || !attachment.fileName}
        className={`inline-flex items-center gap-1.5 text-xs underline disabled:no-underline disabled:opacity-60 ${tone}`}
      >
        <Icon name="document" className="h-3.5 w-3.5" />
        {attachment.label}
        {size && <span className="opacity-70">({size})</span>}
        {opening && <span className="opacity-70">{t('caseThread.opening')}</span>}
      </button>
      {failed && <span className="block text-xs opacity-80">{t('caseThread.openFailed')}</span>}
    </>
  )
}

// Case Handler side only - see CaseThread's render below, which never
// mounts this in mode === 'reporter'. Investigator-facing, on-demand, one
// message at a time: clicking it calls translateMessage for the UI's
// current language and renders the result beneath the original text, which
// is never replaced or hidden. If the server already has a translation for
// this language (message.translations[targetLang], passed down as
// `existing` via serializeMessage), it renders immediately with no call.
function MessageTranslation({ caseId, messageId, targetLang, existing, tone }) {
  const { t } = useTranslation()
  const [translation, setTranslation] = useState(existing ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setTranslation(existing ?? null)
  }, [existing])

  async function handleTranslate() {
    setLoading(true)
    setFailed(false)
    try {
      const result = await translateMessage(caseId, messageId, targetLang)
      setTranslation(result)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  if (translation) {
    return (
      <div className={`mt-2 border-t border-dashed pt-2 ${tone}`}>
        <p className="text-[11px] italic opacity-70">{t('caseThread.translate.resultLabel')}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm italic opacity-80">{translation.text}</p>
      </div>
    )
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={handleTranslate}
        disabled={loading}
        className={`text-xs underline disabled:no-underline disabled:opacity-60 ${tone}`}
      >
        {loading ? t('caseThread.translate.loading') : t('caseThread.translate.action')}
      </button>
      {failed && <span className="ml-2 text-xs opacity-80">{t('caseThread.translate.failed')}</span>}
    </div>
  )
}

// The single ongoing communication channel for a case. Reporter messages,
// AI follow-up questions, and Case Handler messages all share one timeline
// - this component doubles as the audit trail, so nothing here is ever
// deleted or hidden, only appended to. mode is 'reporter' (Case ID +
// passcode) or 'investigator' (the caller's Firebase Auth identity, which
// the callable attaches automatically - see caseThreadService.js).
//
// The heading and page framing belong to whatever renders this; it used to
// carry its own <h2> and page padding, which meant it could only ever be
// dropped onto a page by itself.
function CaseThread({ caseId, mode, passcode }) {
  const { t, i18n } = useTranslation()
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [logDraft, setLogDraft] = useState('')
  const [showLogForm, setShowLogForm] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  // Separate from `error` (send/log-entry failures) and, deliberately, not
  // read by the load effect below - a failed fetch must not feed back into
  // its own trigger, or a 400 becomes an infinite render loop (this is what
  // used to hang the tab). A failed load stops polling instead of retrying
  // itself; `retryToken` is bumped only by the user clicking Retry.
  const [loadError, setLoadError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)
  // Reporter-side only. Distress can surface long after intake, so support
  // resources are reachable from the ongoing thread at any time - no trigger
  // has to fire and nothing has to be answered. Toggling this open is not
  // recorded anywhere.
  const [showResources, setShowResources] = useState(false)
  // scoreCase.js's server-side crisisFlag, read every time the thread loads.
  // It works in every language the reporter might have written in, unlike
  // the client-only check that gates the toggle above - when it's true the
  // panel is shown automatically, identically to the manual toggle, with
  // nothing on screen indicating which trigger fired it.
  const [serverCrisisFlag, setServerCrisisFlag] = useState(false)
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    // A reporter thread is authorised by Case ID + passcode; without a
    // passcode there is nothing to send the server, and calling the
    // reporter callable anyway just trades a clear error for its generic
    // 'invalid-argument' one.
    if (mode === 'reporter' && !passcode) {
      setLoadError(t('caseThread.errors.passcodeRequired'))
      return
    }
    try {
      if (mode === 'investigator') {
        setMessages(await getCaseThreadForHandler(caseId))
      } else {
        const { messages: fetched, crisisFlag } = await getCaseThread(caseId, passcode)
        setMessages(fetched)
        setServerCrisisFlag(crisisFlag)
      }
      setLoadError(null)
    } catch (err) {
      // Stop polling rather than let a failed fetch keep re-firing itself -
      // loadError is not in this effect's dependency array, so setting it
      // here cannot retrigger the effect on its own. The user retries via
      // the button below, which bumps retryToken.
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      setLoadError(err.message)
    }
  }, [caseId, mode, passcode, t])

  useEffect(() => {
    refresh()
    // No real-time listener - the messages subcollection isn't
    // client-readable (see caseThreadService.js), so we poll instead.
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh, retryToken])

  async function handleSend(event) {
    event.preventDefault()
    if (!draft.trim() && pendingFiles.length === 0) return

    setSending(true)
    setError(null)
    try {
      // The passcode is what authorizes each upload for a reporter; in
      // investigator mode it is undefined and the callable falls back to the
      // caller's Firebase Auth identity plus the case assignment check.
      // Uploaded one at a time (not Promise.all) so a failure partway
      // through reports which file it was, via the surrounding catch below.
      const attachments = []
      for (const file of pendingFiles) {
        attachments.push(await uploadCaseEvidence(caseId, file, passcode))
      }

      if (mode === 'reporter') {
        await sendReporterMessage(caseId, passcode, draft, attachments)
      } else {
        await sendInvestigatorMessage(caseId, draft)
      }

      setDraft('')
      setPendingFiles([])
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function addPendingFiles(fileList) {
    setPendingFiles((current) => [...current, ...Array.from(fileList ?? [])])
  }

  function removePendingFile(index) {
    setPendingFiles((current) => current.filter((_, i) => i !== index))
  }

  async function handleAddLog(event) {
    event.preventDefault()
    if (!logDraft.trim()) return

    setSending(true)
    setError(null)
    try {
      await addManualLogEntry(caseId, logDraft)
      setLogDraft('')
      setShowLogForm(false)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const mySender = mode === 'reporter' ? 'reporter' : 'investigator'

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <Alert variant="error">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{loadError}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRetryToken((token) => token + 1)}
            >
              {t('common.retry')}
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {!loadError && messages.length === 0 && (
          <EmptyState
            compact
            icon="mail"
            title={t('caseThread.noMessages.title')}
            description={t('caseThread.noMessages.description')}
          />
        )}

        {messages.map((message) => {
          // Follow-up messages (retaliation follow-up module) are rendered by
          // their own component, full-width and visually distinct from AI and
          // investigator messages - a check-in prompt the reporter answers in
          // place, or the notice that a new retaliation case was filed. Only a
          // reporter (Case ID + passcode) can answer; an investigator sees it
          // read-only.
          if (message.type === 'follow_up') {
            return (
              <div key={message.id} className="w-full">
                <FollowUpPrompt
                  caseId={caseId}
                  passcode={passcode}
                  interactive={mode === 'reporter'}
                  followUp={{ ...(message.followUp ?? {}), text: message.text }}
                  onAnswered={refresh}
                />
              </div>
            )
          }

          const mine =
            message.type !== 'manual_log' &&
            message.sender !== 'system' &&
            message.sender === mySender
          return (
            <div
              key={message.id}
              id={`message-${message.id}`}
              className={`flex flex-col gap-1 scroll-mt-4 ${mine ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${bubbleClasses(message, mine)}`}>
                <div
                  className={`flex items-center justify-between gap-4 text-xs ${
                    mine ? 'text-navy-200' : 'text-muted'
                  }`}
                >
                  <span className="font-medium">{messageAuthorLabel(message, t)}</span>
                  <span>{formatTimestamp(message.timestamp)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message.text}</p>

                {message.attachments?.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.fileName ?? attachment.label}>
                        <AttachmentLink
                          caseId={caseId}
                          mode={mode}
                          passcode={passcode}
                          attachment={attachment}
                          tone={mine ? 'text-white' : 'text-navy'}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {/* Case Handler side only - no reporter-facing counterpart. Hidden
                    for a system record and a manual log entry, neither of which is
                    a reporter's own words to translate. */}
                {mode === 'investigator' &&
                  message.sender !== 'system' &&
                  message.type !== 'manual_log' && (
                    <MessageTranslation
                      caseId={caseId}
                      messageId={message.id}
                      targetLang={i18n.language}
                      existing={message.translations?.[i18n.language]}
                      tone={mine ? 'border-navy-200 text-white' : 'border-line text-charcoal'}
                    />
                  )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSend} className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <textarea
          aria-label={t('caseThread.messageLabel')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={t('caseThread.messagePlaceholder')}
          className="field resize-y"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <span className="btn btn-secondary px-2.5 py-1.5 text-xs">
              <Icon name="plus" className="h-3.5 w-3.5" />
              {t('caseThread.attachFile')}
            </span>
            <input
              type="file"
              multiple
              onChange={(e) => {
                // input.files is a *live* FileList tied to the input -
                // resetting e.target.value below empties it retroactively,
                // and setPendingFiles's updater doesn't run until after this
                // handler returns, so it has to be copied into a plain array
                // synchronously here rather than handed the FileList itself.
                const files = Array.from(e.target.files ?? [])
                // Without resetting the input, choosing the same file again
                // in a later selection fires no change event at all.
                e.target.value = ''
                addPendingFiles(files)
              }}
              className="sr-only"
            />
          </label>

          <Button
            type="submit"
            variant="primary"
            className="ml-auto"
            loading={sending}
            loadingLabel={t('caseThread.sending')}
            disabled={!draft.trim() && pendingFiles.length === 0}
          >
            {t('caseThread.send')}
          </Button>
        </div>

        {pendingFiles.length > 0 && (
          <ul className="flex flex-col gap-1">
            {pendingFiles.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border border-line-soft px-2.5 py-1.5 text-xs text-charcoal"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removePendingFile(index)}
                  className="shrink-0 text-muted underline hover:text-charcoal"
                >
                  {t('caseThread.removeFile')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {/* Persistent opt-in: shown on every visit for a reporter, so someone who
          declined it after submitting - or later cleared the browser permission -
          always has a way back to enabling case-thread notifications. The
          component itself resolves what to render for each browser state,
          including the blocked case. Keyed to the Case ID only. */}
      {mode === 'reporter' && <CaseNotificationOptIn caseId={caseId} passcode={passcode} />}

      {mode === 'reporter' && (
        <div className="border-t border-line-soft pt-3">
          <button
            type="button"
            onClick={() => setShowResources((open) => !open)}
            className="inline-flex items-center gap-1.5 text-xs text-muted underline hover:text-charcoal"
            aria-expanded={showResources}
          >
            <Icon name="shield" className="h-3.5 w-3.5" />
            {t('reporterLayout.needSupport')}
          </button>
          {(showResources || serverCrisisFlag) && (
            <div className="mt-3">
              {/* The reporter's tab holds no jurisdiction, so every regional
                  route plus the international fallback is offered. */}
              <CrisisResources />
            </div>
          )}
        </div>
      )}

      {mode === 'investigator' && (
        <div className="rounded-lg border border-gold-200 bg-gold-50 p-3">
          {!showLogForm ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              onClick={() => setShowLogForm(true)}
              className="text-gold-600"
            >
              {t('caseThread.manualLog.add')}
            </Button>
          ) : (
            <form onSubmit={handleAddLog} className="flex flex-col gap-2">
              <textarea
                aria-label={t('caseThread.manualLog.label')}
                value={logDraft}
                onChange={(e) => setLogDraft(e.target.value)}
                rows={2}
                placeholder={t('caseThread.manualLog.placeholder')}
                className="field border-gold-200"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="accent"
                  size="sm"
                  loading={sending}
                  loadingLabel={t('contactChannelPanel.form.saving')}
                  disabled={!logDraft.trim()}
                >
                  {t('caseThread.manualLog.save')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowLogForm(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default CaseThread
