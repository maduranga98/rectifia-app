import { useState } from 'react'
import { CATEGORIES } from '../../data/categories'

function CategorySelect({ onSelect }) {
  const [selected, setSelected] = useState(null)

  function handleContinue() {
    if (!selected) return
    onSelect?.(selected)
  }

  return (
    <div className="max-w-xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">What's this report about?</h1>
        <p className="mt-1 text-sm text-muted">
          Choose the category that best fits your situation. The next
          questions will be tailored to it.
        </p>
      </div>

      <div className="space-y-3">
        {CATEGORIES.map((category) => (
          <label
            key={category.id}
            className={`block cursor-pointer rounded border px-4 py-3 ${
              selected === category.id
                ? 'border-gold ring-1 ring-gold'
                : 'border-line'
            }`}
          >
            <input
              type="radio"
              name="case-category"
              value={category.id}
              checked={selected === category.id}
              onChange={() => setSelected(category.id)}
              className="sr-only"
            />
            <span className="font-medium">{category.label}</span>
            <p className="mt-1 text-sm text-muted">{category.description}</p>
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={handleContinue}
        disabled={!selected}
        className="btn-primary rounded px-4 py-2 disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  )
}

export default CategorySelect
