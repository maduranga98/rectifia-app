import { useState } from 'react'
import { validateCaseAccess } from '../../services/caseAccessService'

function CaseAccess({ onAccessGranted }) {
  const [caseId, setCaseId] = useState('')
  const [passcode, setPasscode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await validateCaseAccess(caseId, passcode)
      if (!result.valid) {
        setError('Case ID or passcode is incorrect.')
        return
      }
      onAccessGranted?.(result.case)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Access your case</h1>
        <p className="mt-1 text-sm text-muted">
          No account needed. Enter the Case ID and passcode you were given
          when you submitted your report.
        </p>
      </div>

      <div>
        <label htmlFor="case-id" className="block text-sm font-medium">
          Case ID
        </label>
        <input
          id="case-id"
          type="text"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value.toUpperCase())}
          placeholder="RC-2026-8842"
          autoComplete="off"
          required
          className="field mt-1 w-full rounded px-3 py-2 font-mono"
        />
      </div>

      <div>
        <label htmlFor="case-passcode" className="block text-sm font-medium">
          Passcode
        </label>
        <input
          id="case-passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoComplete="off"
          required
          className="field mt-1 w-full rounded px-3 py-2 font-mono"
        />
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !caseId || !passcode}
        className="btn-primary rounded px-4 py-2 disabled:opacity-50"
      >
        {submitting ? 'Checking...' : 'Access case'}
      </button>
    </form>
  )
}

export default CaseAccess
