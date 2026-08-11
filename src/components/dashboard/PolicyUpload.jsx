import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uploadPolicy, validatePolicyFile } from '../../services/policyService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Input } from '../ui/Field'

// Drag-and-drop + file-picker upload card for a company policy document.
// Client-side type/size validation mirrors the server allowlist so an obviously
// wrong file is rejected before an upload URL is spent; the server remains the
// real gate. On success the parent refreshes its table via onUploaded.
function PolicyUpload({ companyId, onUploaded }) {
  const { t } = useTranslation()
  const PROGRESS_LABEL = {
    requesting: t('policyUpload.progress.requesting'),
    uploading: t('policyUpload.progress.uploading'),
    processing: t('policyUpload.progress.processing'),
  }
  const inputRef = useRef(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [failure, setFailure] = useState(null)

  const busy = progress !== null

  function chooseFile(nextFile) {
    setError(null)
    setFailure(null)
    if (!nextFile) return
    const validationError = validatePolicyFile(nextFile)
    if (validationError) {
      setFile(null)
      setError(validationError)
      return
    }
    setFile(nextFile)
    // Default the title to the file's base name so the admin rarely has to type
    // one, but leave it editable.
    if (!title.trim()) {
      setTitle(nextFile.name.replace(/\.[^.]+$/, ''))
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    chooseFile(event.dataTransfer.files?.[0])
  }

  async function handleUpload(event) {
    event.preventDefault()
    if (!file || !title.trim() || busy) return
    setError(null)
    setFailure(null)
    try {
      const result = await uploadPolicy({ companyId, title: title.trim(), file }, setProgress)
      if (result.status === 'failed') {
        setFailure(result.errorMessage || t('policyUpload.couldNotProcess'))
      } else {
        setTitle('')
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
      }
      await onUploaded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <form onSubmit={handleUpload} className="flex flex-col gap-4">
      <Input
        label={t('policyUpload.titleLabel')}
        placeholder={t('policyUpload.titlePlaceholder')}
        hint={t('policyUpload.titleHint')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
      />

      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-navy bg-navy-50/60' : 'border-line hover:border-navy-300'
        } ${busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        aria-label={t('policyUpload.dropZoneAriaLabel')}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-50 text-navy">
          <Icon name="document" className="h-5 w-5" />
        </span>
        {file ? (
          <span className="text-sm font-medium text-charcoal">{file.name}</span>
        ) : (
          <>
            <span className="text-sm font-medium text-charcoal">{t('policyUpload.dropHint')}</span>
            <span className="text-xs text-muted">{t('policyUpload.fileTypesHint')}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />

      {error && <Alert variant="error">{error}</Alert>}
      {failure && (
        <Alert variant="error" title={t('policyUpload.processingFailed.title')}>
          {failure} {t('policyUpload.processingFailed.body')}
        </Alert>
      )}
      {busy && (
        <p className="text-sm text-muted">{PROGRESS_LABEL[progress] ?? t('policyUpload.progress.working')}</p>
      )}

      <Button
        type="submit"
        variant="primary"
        icon="plus"
        className="self-start"
        loading={busy}
        loadingLabel={PROGRESS_LABEL[progress] ?? t('policyUpload.progress.uploading')}
        disabled={!file || !title.trim()}
      >
        {t('policyUpload.uploadButton')}
      </Button>
    </form>
  )
}

export default PolicyUpload
