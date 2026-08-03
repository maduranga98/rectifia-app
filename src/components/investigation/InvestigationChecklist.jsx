import { useState } from 'react'
import {
  CHECKLIST_ITEM_STATUSES,
  CHECKLIST_ITEM_TYPES,
  generateChecklist,
  setChecklistItemStatus,
} from '../../services/checklistService'

const TYPE_LABELS = {
  [CHECKLIST_ITEM_TYPES.INTERVIEW_QUESTION]: 'Interview question',
  [CHECKLIST_ITEM_TYPES.DOCUMENT_REQUEST]: 'Document to request',
  [CHECKLIST_ITEM_TYPES.CONTRADICTION_FLAG]: 'Contradiction / gap',
}

const TYPE_STYLE = {
  [CHECKLIST_ITEM_TYPES.INTERVIEW_QUESTION]: 'border-blue-200 bg-blue-50 text-blue-700',
  [CHECKLIST_ITEM_TYPES.DOCUMENT_REQUEST]: 'border-purple-200 bg-purple-50 text-purple-700',
  [CHECKLIST_ITEM_TYPES.CONTRADICTION_FLAG]: 'border-amber-300 bg-amber-50 text-amber-700',
}

// Suggestions the assigned Case Handler can check off, edit, or ignore -
// never a gate anything else in the app depends on. Generation is
// on-demand (not automatic) since the checklist is only as good as the
// thread it's built from, and the handler decides when there's enough
// there to be worth regenerating from.
function InvestigationChecklist({ caseId, investigatorId }) {
  const [checklist, setChecklist] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const result = await generateChecklist(caseId, investigatorId)
      setChecklist(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateItem(itemId, status, text) {
    setError(null)
    try {
      const result = await setChecklistItemStatus(caseId, itemId, status, text)
      setChecklist(result)
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditDraft(item.item)
  }

  async function saveEdit(itemId) {
    if (!editDraft.trim()) return
    await updateItem(itemId, CHECKLIST_ITEM_STATUSES.EDITED, editDraft)
    setEditingId(null)
    setEditDraft('')
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Investigation checklist</h2>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? 'Generating...' : checklist.length > 0 ? 'Regenerate' : 'Generate checklist'}
        </button>
      </div>

      <p className="text-xs text-gray-500">
        AI-suggested next steps based on the case category, questionnaire answers, and thread so far. Check off, edit,
        or ignore anything - this is a planning aid, not a required workflow.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {checklist.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No checklist yet. Generate one to get started.</p>
      )}

      <ul className="flex flex-col gap-3">
        {checklist.map((item) => (
          <li
            key={item.id}
            className={`rounded border px-3 py-2 text-sm ${
              item.status === CHECKLIST_ITEM_STATUSES.IGNORED ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={item.status === CHECKLIST_ITEM_STATUSES.CHECKED}
                onChange={(e) =>
                  updateItem(
                    item.id,
                    e.target.checked ? CHECKLIST_ITEM_STATUSES.CHECKED : CHECKLIST_ITEM_STATUSES.SUGGESTED
                  )
                }
                className="mt-1"
              />
              <div className="flex-1">
                <span className={`inline-block rounded border px-2 py-0.5 text-xs ${TYPE_STYLE[item.type]}`}>
                  {TYPE_LABELS[item.type] ?? item.type}
                </span>

                {editingId === item.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => saveEdit(item.id)}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white"
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-500">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    className={`mt-1 ${
                      item.status === CHECKLIST_ITEM_STATUSES.CHECKED ? 'line-through text-gray-400' : ''
                    }`}
                  >
                    {item.item}
                  </p>
                )}

                <p className="mt-1 text-xs text-gray-500">{item.rationale}</p>

                {editingId !== item.id && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button type="button" onClick={() => startEdit(item)} className="text-blue-600 underline">
                      Edit
                    </button>
                    {item.status !== CHECKLIST_ITEM_STATUSES.IGNORED ? (
                      <button
                        type="button"
                        onClick={() => updateItem(item.id, CHECKLIST_ITEM_STATUSES.IGNORED)}
                        className="text-gray-500 underline"
                      >
                        Ignore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => updateItem(item.id, CHECKLIST_ITEM_STATUSES.SUGGESTED)}
                        className="text-gray-500 underline"
                      >
                        Unignore
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default InvestigationChecklist
