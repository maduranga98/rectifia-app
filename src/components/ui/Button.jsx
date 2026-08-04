import Icon from './Icon'

const VARIANTS = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  dangerGhost: 'btn-danger-ghost',
}

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: '',
  lg: 'px-5 py-2.5 text-sm',
}

// Every button in the app. Variant picks the colour treatment, size adjusts
// the padding the `btn` base sets, `icon` renders a leading glyph, and
// `loading` swaps the label for `loadingLabel` while disabling the control -
// so no page has to hand-roll the "Saving..." + disabled + opacity-50 trio
// that every form here was repeating.
function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  loadingLabel,
  className = '',
  children,
  type = 'button',
  disabled,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`btn ${VARIANTS[variant] ?? VARIANTS.secondary} ${SIZES[size] ?? ''} ${className}`}
      {...props}
    >
      {loading ? (
        <Spinner />
      ) : (
        icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      )}
      {loading ? (loadingLabel ?? children) : children}
    </button>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default Button
