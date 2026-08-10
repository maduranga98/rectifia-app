import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCaseThreadForHandler, getEvidenceDownloadUrl } from '../../services/caseThreadService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'
import { SkeletonList } from '../ui/Loading'

function formatTimestamp(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Mirrors CaseThread.jsx's messageAuthorLabel, narrowed to the senders that
// can actually carry an attachment.
function supplierLabel(message) {
  if (message.type === 'manual_log') return 'Manual log entry'
  if (message.sender === 'ai') return 'AI assistant'
  if (message.sender === 'investigator') return 'Case Handler'
  return 'Reporter'
}

// Opens a fresh, short-lived signed URL for one file, exactly as
// CaseThread.jsx's AttachmentLink does for a handler (no passcode - the
// callable authorises by Firebase Auth identity). The URL is never stored
// in state; it lives only inside this click handler.
function OpenAction({ caseId, fileName }) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  async function open() {
    setOpening(true)
    setFailed(false)
    try {
      const url = await getEvidenceDownloadUrl(caseId, fileName)
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

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" icon="document" onClick={open} loading={opening} loadingLabel="Opening" disabled={!fileName}>
        Open
      </Button>
      {failed && <span className="text-xs text-critical">Could not open this file.</span>}
    </div>
  )
}

// A read-only, consolidated inventory of every file attached anywhere in the
// case thread. It adds no read path of its own: the same
// getCaseThreadForHandler(caseId) call CaseThread.jsx already makes is the
// only source, and every row's Open action reuses getEvidenceDownloadUrl the
// same way CaseThread.jsx's AttachmentLink does. This exists because the
// thread scatters evidence across dozens of messages a handler would
// otherwise have to scroll through one at a time.
function CaseEvidencePanel({ caseId }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setMessages(await getCaseThreadForHandler(caseId))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) return <SkeletonList rows={4} />
  if (error) return <Alert variant="error">{error}</Alert>

  const files = messages
    .flatMap((message) =>
      (message.attachments ?? []).map((attachment) => ({
        ...attachment,
        uploadedAt: message.timestamp,
        supplier: supplierLabel(message),
        messageId: message.id,
      }))
    )
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))

  return (
    <Card
      title="Evidence"
      description={files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} attached across this case's thread.` : undefined}
      padded={files.length === 0}
    >
      {files.length === 0 ? (
        <EmptyState
          icon="document"
          title="No evidence has been attached to this case yet."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Supplied by</th>
                <th>Thread</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={`${file.messageId}-${file.fileName ?? file.label}`}>
                  <td className="font-medium text-charcoal">
                    <span className="flex items-center gap-1.5">
                      <Icon name="document" className="h-3.5 w-3.5 shrink-0 text-muted" />
                      {file.label}
                    </span>
                  </td>
                  <td className="text-muted">{file.contentType ?? '—'}</td>
                  <td className="tabular-nums text-muted">{formatSize(file.sizeBytes)}</td>
                  <td className="text-muted">{formatTimestamp(file.uploadedAt)}</td>
                  <td className="text-muted">{file.supplier}</td>
                  <td>
                    <Link
                      to={`/dashboard/cases/${caseId}/thread#message-${file.messageId}`}
                      className="text-xs text-navy underline"
                    >
                      View in thread
                    </Link>
                  </td>
                  <td>
                    <OpenAction caseId={caseId} fileName={file.fileName} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default CaseEvidencePanel
