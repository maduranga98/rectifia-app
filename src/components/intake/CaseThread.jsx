import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addManualLogEntry,
  getCaseThread,
  sendInvestigatorMessage,
  sendReporterMessage,
  uploadCaseEvidence,
} from '../../services/caseThreadService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'

const POLL_INTERVAL_MS = 8000

function formatTimestamp(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString()
}

function messageAuthorLabel(message) {
  if (message.type === 'manual_log') return 'Investigator log'
  if (message.sender === 'ai') return 'AI assistant'
  if (message.sender === 'investigator') return 'Case Handler'
  return 'Reporter'
}

// Bubble treatment per author. "Mine" (whoever is reading) sits on the
// right in navy; everyone else is a light bubble on the left, and a manual
// log entry is amber and full-width because it is a record rather than a
// message to anyone.
function bubbleClasses(message, mine) {
  if (message.type === 'manual_log') return 'tone-high border w-full'
  if (mine) return 'bg-navy text-white border border-navy'
  if (message.sender === 'ai') return 'border border-navy-200 bg-navy-50 text-charcoal'
  return 'border border-line bg-surface text-charcoal'
}

// The single ongoing communication channel for a case. Reporter messages,
// AI follow-up questions, and Case Handler messages all share one timeline
// - this component doubles as the audit trail, so nothing here is ever
// deleted or hidden, only appended to. mode is 'reporter' (Case ID +
// passcode) or 'investigator' (investigatorId - see caseThreadService.js
// for the current no-auth caveat on that side).
//
// The heading and page framing belong to whatever renders this; it used to
// carry its own <h2> and page padding, which meant it could only ever be
// dropped onto a page by itself.
function CaseThread({ caseId, mode, passcode, investigatorId }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [pendingFile, setPendingFile] = useState(null)
  const [logDraft, setLogDraft] = useState('')
  const [showLogForm, setShowLogForm] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const fetched = await getCaseThread(caseId, passcode)
      setMessages(fetched)
    } catch (err) {
      setError(err.message)
    }
  }, [caseId, passcode])

  useEffect(() => {
    refresh()
    // No real-time listener - the messages subcollection isn't
    // client-readable (see caseThreadService.js), so we poll instead.
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(pollRef.current)
  }, [refresh])

  async function handleSend(event) {
    event.preventDefault()
    if (!draft.trim() && !pendingFile) return

    setSending(true)
    setError(null)
    try {
      let attachments = []
      if (pendingFile) {
        const uploaded = await uploadCaseEvidence(caseId, pendingFile)
        attachments = [uploaded]
      }

      if (mode === 'reporter') {
        await sendReporterMessage(caseId, passcode, draft, attachments)
      } else {
        await sendInvestigatorMessage(caseId, investigatorId, draft)
      }

      setDraft('')
      setPendingFile(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleAddLog(event) {
    event.preventDefault()
    if (!logDraft.trim()) return

    setSending(true)
    setError(null)
    try {
      await addManualLogEntry(caseId, investigatorId, logDraft)
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
      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <EmptyState
            compact
            icon="mail"
            title="No messages yet"
            description="Anything sent here is added to the case record permanently."
          />
        )}

        {messages.map((message) => {
          const mine = message.type !== 'manual_log' && message.sender === mySender
          return (
            <div
              key={message.id}
              className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${bubbleClasses(message, mine)}`}>
                <div
                  className={`flex items-center justify-between gap-4 text-xs ${
                    mine ? 'text-navy-200' : 'text-muted'
                  }`}
                >
                  <span className="font-medium">{messageAuthorLabel(message)}</span>
                  <span>{formatTimestamp(message.timestamp)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message.text}</p>

                {message.attachments?.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.path}>
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1.5 text-xs underline ${
                            mine ? 'text-white' : 'text-navy'
                          }`}
                        >
                          <Icon name="document" className="h-3.5 w-3.5" />
                          {attachment.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSend} className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <textarea
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Type a message..."
          className="field resize-y"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <span className="btn btn-secondary px-2.5 py-1.5 text-xs">
              <Icon name="plus" className="h-3.5 w-3.5" />
              Attach file
            </span>
            <input
              type="file"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            {pendingFile && <span className="truncate">{pendingFile.name}</span>}
          </label>

          <Button
            type="submit"
            variant="primary"
            className="ml-auto"
            loading={sending}
            loadingLabel="Sending"
            disabled={!draft.trim() && !pendingFile}
          >
            Send
          </Button>
        </div>
      </form>

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
              Add manual log entry
            </Button>
          ) : (
            <form onSubmit={handleAddLog} className="flex flex-col gap-2">
              <textarea
                aria-label="Manual log entry"
                value={logDraft}
                onChange={(e) => setLogDraft(e.target.value)}
                rows={2}
                placeholder="e.g. Called witness X, summary: ..."
                className="field border-gold-200"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="accent"
                  size="sm"
                  loading={sending}
                  loadingLabel="Saving"
                  disabled={!logDraft.trim()}
                >
                  Save log entry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowLogForm(false)}>
                  Cancel
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
