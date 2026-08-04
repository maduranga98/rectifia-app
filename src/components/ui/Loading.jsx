import Logo from './Logo'

// Skeleton rows for a card/list that hasn't loaded. A shaped placeholder
// holds the layout still, where the "Loading..." line every page used to
// render made the whole screen jump once data arrived.
export function SkeletonList({ rows = 3, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full" />
      ))}
    </div>
  )
}

export function SkeletonStats({ count = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-[86px]" />
      ))}
    </div>
  )
}

// Whole-screen wait: auth resolution, route guards. Branded rather than a
// bare sentence, because this is often the very first frame of the app.
export function FullPageLoader({ label = 'Loading', onDark = false }) {
  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center gap-4 ${
        onDark ? 'auth-backdrop' : ''
      }`}
    >
      <span className="animate-pulse">
        <Logo size="lg" showWordmark={false} onDark={onDark} />
      </span>
      <p className={`text-sm ${onDark ? 'text-navy-200' : 'text-muted'}`} role="status">
        {label}
      </p>
    </div>
  )
}
