import { useId } from 'react'

// Label + control + hint/error, wired together. The `id`/`htmlFor` pairing
// and the aria-describedby link are generated here so that no form in the
// app ships an unlabelled input by accident - previously every form was a
// bare placeholder-only <input>, which leaves a screen reader with nothing
// once the field has a value in it.
function FieldShell({ label, hint, error, required, htmlFor, describedBy, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-charcoal">
          {label}
          {required && <span className="ml-0.5 text-critical">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={describedBy} className="text-xs text-critical">
          {error}
        </p>
      ) : (
        hint && (
          <p id={describedBy} className="text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function Input({ label, hint, error, className = '', id, ...props }) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = `${fieldId}-desc`

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      htmlFor={fieldId}
      describedBy={describedBy}
    >
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? describedBy : undefined}
        className={`field ${error ? 'border-critical' : ''} ${className}`}
        {...props}
      />
    </FieldShell>
  )
}

export function Select({ label, hint, error, className = '', id, children, ...props }) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = `${fieldId}-desc`

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      htmlFor={fieldId}
      describedBy={describedBy}
    >
      <select
        id={fieldId}
        aria-describedby={hint || error ? describedBy : undefined}
        className={`field ${className}`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  )
}

export function Textarea({ label, hint, error, className = '', id, rows = 3, ...props }) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = `${fieldId}-desc`

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      htmlFor={fieldId}
      describedBy={describedBy}
    >
      <textarea
        id={fieldId}
        rows={rows}
        aria-describedby={hint || error ? describedBy : undefined}
        className={`field resize-y ${className}`}
        {...props}
      />
    </FieldShell>
  )
}
