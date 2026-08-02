import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addManualLogEntry,
  getCaseThread,
  sendInvestigatorMessage,
  sendReporterMessage,
  uploadCaseEvidence,
} from '../../services/caseThreadService'

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

function messageStyle(message) {
  if (message.type === 'manual_log') return 'border-amber-300 bg-amber-50'
  if (message.sender === 'ai') return 'border-blue-200 bg-blue-50'
  return 'border-gray-200 bg-white'
}

// The single ongoing communication channel for a case. Reporter messages,
// AI follow-up questions, and Case Handler messages all share one timeline
// - this component doubles as the audit trail, so nothing here is ever
// deleted or hidden, only appended to. mode is 'reporter' (Case ID +
// passcode) or 'investigator' (investigatorId - see caseThreadService.js
// for the current no-auth caveat on that side).
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-xl font-semibold">Case thread</h2>

      <div className="flex flex-col gap-3 rounded border border-gray-200 p-4">
        {messages.length === 0 && <p className="text-sm text-gray-500">No messages yet.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`rounded border px-3 py-2 text-sm ${messageStyle(message)}`}>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-medium">{messageAuthorLabel(message)}</span>
              <span>{formatTimestamp(message.timestamp)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            {message.attachments?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {message.attachments.map((attachment) => (
                  <li key={attachment.path}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 underline"
                    >
                      {attachment.filename}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSend} className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Type a message..."
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <input
            type="file"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <button
            type="submit"
            disabled={sending}
            className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>

      {mode === 'investigator' && (
        <div className="rounded border border-amber-200 p-3">
          {!showLogForm ? (
            <button
              type="button"
              onClick={() => setShowLogForm(true)}
              className="text-sm text-amber-700 underline"
            >
              + Add manual log entry
            </button>
          ) : (
            <form onSubmit={handleAddLog} className="flex flex-col gap-2">
              <textarea
                value={logDraft}
                onChange={(e) => setLogDraft(e.target.value)}
                rows={2}
                placeholder="e.g. Called witness X, summary: ..."
                className="w-full rounded border border-amber-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Save log entry
                </button>
                <button type="button" onClick={() => setShowLogForm(false)} className="text-sm text-gray-500">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default CaseThread
