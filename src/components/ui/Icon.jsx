// A tiny inline icon set. Deliberately not an icon dependency: the app uses
// a dozen glyphs, all single-stroke and on one 24px grid, and shipping a
// package for that would cost more than the paths do.
//
// Every icon draws with `currentColor` and inherits stroke width, so an icon
// sitting in a muted label is muted and one in a white sidebar link is white
// without either call site saying so.
const PATHS = {
  overview: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  departments:
    'M3 21V8l6-4 6 4v13M9 21v-4h3v4M15 21V11l6 3v7M6 11h.01M6 14h.01',
  staff:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  routing: 'M5 3v6a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v6M5 3 2 6m3-3 3 3m11 15 3-3m-3 3-3-3',
  billing: 'M2 7h20v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm0 4h20M6 16h4',
  cases: 'M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Zm5 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 12h6M9 16h4',
  pulse: 'M3 12h4l2-7 4 14 2-7h6',
  company: 'M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h4a2 2 0 0 1 2 2v10M8 7h2M8 11h2M8 15h2',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  refresh: 'M21 12a9 9 0 1 1-3.2-6.9M21 3v6h-6',
  plus: 'M12 5v14M5 12h14',
  back: 'M19 12H5m7-7-7 7 7 7',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'm20 6-11 11-5-5',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2m3.45-7.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-7.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79.89Z',
  mail: 'M2 6h20v12H2V6Zm0 0 10 7 10-7',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  chevronRight: 'm9 6 6 6-6 6',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8',
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4',
  search: 'm21 21-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.5 7.5 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2.2-1.3L14.2 2H9.8l-.4 2.6a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.6h4.4l.4-2.6a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.07-.43.1-.86.1-1.3Z',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:
    'M3 3l18 18 M10.6 10.6a3 3 0 0 0 4.24 4.24 M9.4 5.5A11.6 11.6 0 0 1 12 5c7 0 11 7 11 7a13.9 13.9 0 0 1-3.4 4.1 M6.3 6.9C3.7 8.5 2 11.3 1 12c0 0 4 7 11 7a11.4 11.4 0 0 0 4.6-.96',
}

function Icon({ name, className = 'h-4 w-4', strokeWidth = 1.75 }) {
  const d = PATHS[name]
  if (!d) return null

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  )
}

export default Icon
