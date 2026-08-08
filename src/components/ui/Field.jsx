import { useId, useState } from 'react'
import Icon from './Icon'

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

// A password field gets a trailing show/hide button inside itself rather
// than a second control next to it - `type` is swapped between 'password'
// and 'text' on the same input, so autoComplete (already correct per-form:
// 'current-password', 'new-password', etc.) travels with it undisturbed.
// Hidden is the default on every render, including after a value changes,
// since this is local UI state, not something a caller has a reason to
// control.
function PasswordToggle({ visible, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? 'Hide password' : 'Show password'}
      aria-pressed={visible}
      className="absolute inset-y-0 right-0 flex items-center px-3 text-subtle transition-colors hover:text-charcoal"
    >
      <Icon name={visible ? 'eyeOff' : 'eye'} className="h-4 w-4" />
    </button>
  )
}

export function Input({ label, hint, error, className = '', id, type, ...props }) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = `${fieldId}-desc`
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  const resolvedType = isPassword ? (visible ? 'text' : 'password') : type

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      htmlFor={fieldId}
      describedBy={describedBy}
    >
      <div className="relative">
        <input
          id={fieldId}
          type={resolvedType}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? describedBy : undefined}
          className={`field ${error ? 'border-critical' : ''} ${isPassword ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {isPassword && <PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} />}
      </div>
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
