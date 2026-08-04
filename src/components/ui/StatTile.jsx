import Icon from './Icon'

// Accent bar colour per tone. A stat tile is a white card with a coloured
// rail rather than a fully tinted block: a row of four saturated blocks
// reads as four warnings, which is exactly wrong when three of them are
// just counts.
const RAIL = {
  'tone-critical': 'bg-critical',
  'tone-high': 'bg-gold',
  'tone-medium': 'bg-medium',
  'tone-low': 'bg-low',
  'tone-info': 'bg-info',
  'tone-neutral': 'bg-navy-200',
}

const VALUE_COLOR = {
  'tone-critical': 'text-critical',
  'tone-high': 'text-gold-600',
  'tone-medium': 'text-medium',
  'tone-low': 'text-low',
  'tone-info': 'text-navy',
  'tone-neutral': 'text-charcoal',
}

// One number with its label. `hint` carries the qualifier that used to get
// crammed into the label ("Approaching deadlines (48h)") so the label itself
// stays scannable.
function StatTile({ label, value, tone = 'tone-neutral', icon, hint }) {
  return (
    <div className="card relative flex flex-col gap-1 overflow-hidden px-4 py-3.5 pl-5">
      <span
        className={`absolute inset-y-0 left-0 w-1 ${RAIL[tone] ?? RAIL['tone-neutral']}`}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${VALUE_COLOR[tone] ?? VALUE_COLOR['tone-neutral']}`}>
          {value}
        </span>
        {icon && <Icon name={icon} className="h-4 w-4 text-subtle" />}
      </div>
      <span className="text-sm font-medium text-charcoal">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

export default StatTile
