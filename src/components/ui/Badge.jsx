import Icon from './Icon'

// Status chip. `tone` is one of the tone-* classes from index.css, so a
// badge's colour comes from the same severity scale the callouts and stat
// tiles use rather than a per-component lookup table of hex values.
function Badge({ tone = 'tone-neutral', icon, dot = false, className = '', children }) {
  return (
    <span className={`pill ${tone} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />}
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  )
}

export default Badge
