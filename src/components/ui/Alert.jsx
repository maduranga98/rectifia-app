import Icon from './Icon'

const VARIANTS = {
  error: { tone: 'tone-critical', icon: 'alert' },
  warning: { tone: 'tone-high', icon: 'alert' },
  success: { tone: 'tone-low', icon: 'check' },
  info: { tone: 'tone-info', icon: 'alert' },
}

// Inline message block. Errors used to appear as a bare red sentence that
// was easy to miss between two form rows; giving them a bordered, tinted
// block with an icon puts them at the weight the message actually has.
function Alert({ variant = 'info', title, className = '', children }) {
  const { tone, icon } = VARIANTS[variant] ?? VARIANTS.info

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${tone} ${className}`}
    >
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  )
}

export default Alert
