import logoUrl from '/logo.png'

const MARK_SIZE = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
}

const WORD_SIZE = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
}

// The Rectifia mark (public/logo.png) plus optional wordmark. The mark
// carries its own navy tile, so on a navy surface it needs a hairline ring
// to keep its edge from dissolving into the background - that's what
// `onDark` switches on, along with the wordmark colour.
//
// Nothing else in the app should reference /logo.png directly: sizing, the
// ring, and the alt text are decided once, here.
function Logo({ size = 'md', showWordmark = true, onDark = false, subtitle }) {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src={logoUrl}
        alt="Rectifia"
        width={48}
        height={48}
        className={`${MARK_SIZE[size]} shrink-0 rounded-[22%] object-contain ${
          onDark ? 'ring-1 ring-white/15' : ''
        }`}
      />
      {showWordmark && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className={`${WORD_SIZE[size]} font-semibold tracking-tight ${
              onDark ? 'text-white' : 'text-navy'
            }`}
          >
            Rectifia
          </span>
          {subtitle && (
            <span
              className={`truncate text-xs ${
                onDark ? 'text-navy-200' : 'text-muted'
              }`}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

export default Logo
