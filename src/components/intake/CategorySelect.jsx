import { useState } from 'react'
import { CATEGORIES } from '../../data/categories'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// First step of a report. The category decides which questionnaire follows,
// so the options are rendered as full selectable cards - a radio list this
// consequential should be readable at arm's length, not squeezed into a
// dropdown.
function CategorySelect({ onSelect }) {
  const [selected, setSelected] = useState(null)

  function handleContinue() {
    if (!selected) return
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
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
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
              <span className="min-w-0">
                <span className="block font-medium text-charcoal">{category.label}</span>
                <span className="mt-0.5 block text-sm text-muted">{category.description}</span>
              </span>
            </label>
          )
        })}
      </div>

      <Button
        variant="primary"
        size="lg"
        onClick={handleContinue}
        disabled={!selected}
        className="self-start"
      >
        Continue
      </Button>
    </div>
  )
}

export default CategorySelect
