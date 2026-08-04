// The app's single container. A card is a titled region with optional
// header actions and an optional footer; `padded={false}` hands the body
// straight to a table or list that manages its own edges.
function Card({ title, description, actions, footer, padded = true, className = '', children }) {
  const hasHeader = Boolean(title || description || actions)

  return (
    <section className={`card overflow-hidden ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-charcoal">{title}</h3>}
            {description && <p className="mt-1 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}

      <div className={padded ? 'px-5 py-4' : ''}>{children}</div>

      {footer && (
        <footer className="border-t border-line-soft bg-navy-50/50 px-5 py-3">{footer}</footer>
      )}
    </section>
  )
}

export default Card
