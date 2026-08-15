import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORIES } from '../../data/categories'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// First step of a report. The category decides which questionnaire follows,
// so the options are rendered as full selectable cards - a radio list this
// consequential should be readable at arm's length, not squeezed into a
// dropdown.
//
// `children`, rendered between the category list and the Continue button, is
// where Submit.jsx mounts DataHandlingNotice - this is the reporter's last
// stop before they start typing case content, which is why the notice lives
// here rather than at final submit. `canContinue` (default true) lets that
// notice gate advancing past this step without CategorySelect needing to
// know anything about what it's gating on.
function CategorySelect({ onSelect, canContinue = true, children }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(null)

  function handleContinue() {
    if (!selected || !canContinue) return
    onSelect?.(selected)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        {CATEGORIES.map((category) => {
          const checked = selected === category.id
          return (
            <label
              key={category.id}
              // min-h-11 keeps this a comfortable tap target even for the
              // shortest label, since a reporter filing on a phone is the
              // baseline case here, not the exception.
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-all ${
                checked
                  ? 'border-navy bg-navy-50 shadow-[var(--shadow-card)]'
                  : 'border-line bg-surface hover:border-navy-200 hover:bg-navy-50/40'
              }`}
            >
              <input
                type="radio"
                name="case-category"
                value={category.id}
                checked={checked}
                onChange={() => setSelected(category.id)}
                className="sr-only"
              />
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  checked ? 'border-navy bg-navy text-white' : 'border-line-soft bg-surface'
                }`}
                aria-hidden="true"
              >
                {checked && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
              </span>
              {/* Description wraps onto its own line rather than truncating -
                  it used to sit inline with the label on one line and get cut
                  off with an ellipsis, readable only via the title tooltip
                  (useless on a phone, where filing a report is the baseline
                  case here). */}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-charcoal">{t(`categories.${category.id}.label`)}</span>
                <span className="mt-0.5 block text-sm text-muted">
                  {t(`categories.${category.id}.description`)}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      {children}

      <div className="flex flex-col gap-1.5">
        <Button
          variant="primary"
          size="lg"
          onClick={handleContinue}
          disabled={!selected || !canContinue}
          className="min-h-11 self-start"
        >
          {t('categorySelect.continue')}
        </Button>
        {selected && !canContinue && (
          <p className="text-xs text-muted">{t('categorySelect.acknowledgeToContinue')}</p>
        )}
      </div>
    </div>
  )
}

export default CategorySelect
