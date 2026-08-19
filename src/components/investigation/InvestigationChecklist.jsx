import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  CHECKLIST_ITEM_STATUSES,
  CHECKLIST_ITEM_TYPES,
  generateChecklist,
  setChecklistItemStatus,
} from '../../services/checklistService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Textarea } from '../ui/Field'

const TYPE_TONE = {
  [CHECKLIST_ITEM_TYPES.INTERVIEW_QUESTION]: 'tone-info',
  [CHECKLIST_ITEM_TYPES.DOCUMENT_REQUEST]: 'tone-neutral',
  [CHECKLIST_ITEM_TYPES.CONTRADICTION_FLAG]: 'tone-high',
}

// Suggestions the assigned Case Handler can check off, edit, or ignore -
// never a gate anything else in the app depends on. Generation is
// on-demand (not automatic) since the checklist is only as good as the
// thread it's built from, and the handler decides when there's enough
// there to be worth regenerating from.
function InvestigationChecklist({ caseId, threadPath }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const TYPE_LABELS = {
    [CHECKLIST_ITEM_TYPES.INTERVIEW_QUESTION]: t('investigationChecklist.types.interviewQuestion'),
    [CHECKLIST_ITEM_TYPES.DOCUMENT_REQUEST]: t('investigationChecklist.types.documentRequest'),
    [CHECKLIST_ITEM_TYPES.CONTRADICTION_FLAG]: t('investigationChecklist.types.contradictionFlag'),
  }
  const [checklist, setChecklist] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const result = await generateChecklist(caseId)
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

  const generateButton = (
    <Button
      variant={checklist.length > 0 ? 'secondary' : 'primary'}
      size="sm"
      icon="sparkle"
      onClick={handleGenerate}
      loading={loading}
      loadingLabel={t('investigationChecklist.generating')}
    >
      {checklist.length > 0 ? t('investigationChecklist.regenerate') : t('investigationChecklist.generate')}
    </Button>
  )

  return (
    <Card
      title={t('investigationChecklist.title')}
      description={t('investigationChecklist.description')}
      actions={generateButton}
      padded={checklist.length > 0 || Boolean(error)}
    >
      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      {checklist.length === 0 ? (
        !error && (
          <EmptyState
            compact
            icon="sparkle"
            title={t('investigationChecklist.empty.title')}
            description={t('investigationChecklist.empty.description')}
            action={generateButton}
          />
        )
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {checklist.map((item) => {
            const checked = item.status === CHECKLIST_ITEM_STATUSES.CHECKED
            const ignored = item.status === CHECKLIST_ITEM_STATUSES.IGNORED

            return (
              <li key={item.id} className={`py-3 first:pt-0 last:pb-0 ${ignored ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={t('investigationChecklist.markAsDone', { item: item.item })}
                    checked={checked}
                    onChange={(e) =>
                      updateItem(
                        item.id,
                        e.target.checked ? CHECKLIST_ITEM_STATUSES.CHECKED : CHECKLIST_ITEM_STATUSES.SUGGESTED
                      )
                    }
                    className="mt-1 h-4 w-4 shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <Badge tone={TYPE_TONE[item.type] ?? 'tone-neutral'}>
                      {TYPE_LABELS[item.type] ?? item.type}
                    </Badge>

                    {editingId === item.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <Textarea
                          label={t('investigationChecklist.editItem')}
                          rows={2}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button variant="primary" size="sm" onClick={() => saveEdit(item.id)}>
                            {t('investigationChecklist.save')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className={`mt-1.5 text-sm ${checked ? 'text-muted line-through' : 'text-charcoal'}`}>
                        {item.item}
                      </p>
                    )}

                    {item.rationale && <p className="mt-1 text-xs text-muted">{item.rationale}</p>}

                    {editingId !== item.id && (
                      <div className="mt-1.5 flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                          {t('investigationChecklist.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateItem(
                              item.id,
                              ignored ? CHECKLIST_ITEM_STATUSES.SUGGESTED : CHECKLIST_ITEM_STATUSES.IGNORED
                            )
                          }
                        >
                          {ignored ? t('investigationChecklist.unignore') : t('investigationChecklist.ignore')}
                        </Button>
                        {(item.type === CHECKLIST_ITEM_TYPES.INTERVIEW_QUESTION ||
                          item.type === CHECKLIST_ITEM_TYPES.DOCUMENT_REQUEST) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(threadPath, { state: { draftText: item.item } })}
                          >
                            {t('investigationChecklist.useInThread')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export default InvestigationChecklist
