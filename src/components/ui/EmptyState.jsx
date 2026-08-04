import Icon from './Icon'

// What a list shows before it has anything in it. The old screens said
// "No departments yet." in muted 14px and stopped there, which reads as a
// failed load; an empty state should name the thing, say why it's empty,
// and point at the action that fills it.
function EmptyState({ icon = 'inbox', title, description, action, compact = false }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center ${
        compact ? 'px-4 py-8' : 'px-6 py-14'
      }`}
    >
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-navy-50 text-navy-300">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-charcoal">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export default EmptyState
