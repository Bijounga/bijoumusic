import type { ReactNode } from 'react'
import styles from './ActionIcons.module.css'

// Icon buttons for the bottom bar (they replaced word labels). All draw in
// currentColor, so each theme's button text color — including the active and
// hover states — carries over to the icon automatically.

interface IconProps {
  size?: number
}

function Svg({ size = 17, children }: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const TagIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
  </Svg>
)

export const AliasIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
)

export const BookmarkIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </Svg>
)

/** A play triangle inside brackets: the "best part" preview clip. */
export const ClipIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 4H4v16h3M17 4h3v16h-3" />
    <path d="M10.5 8.5v7l5-3.5z" fill="currentColor" />
  </Svg>
)

export const ProjectIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="2.2" />
    <path d="M7 2.5v19M17 2.5v19M2.5 12h19M2.5 7h4.5M2.5 17h4.5M17 17h4.5M17 7h4.5" />
  </Svg>
)

/** Two bars with a double arrow between them: drag out a range. */
export const RangeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 5v14M20 5v14M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
  </Svg>
)

export const RepeatIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Svg>
)

export const SkimIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13 19l9-7-9-7zM2 19l9-7-9-7z" />
  </Svg>
)

export const SendIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5M12 3v12" />
  </Svg>
)

export const SpeedIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m12 14 4-4" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </Svg>
)

/** An icon with an optional small count beside it (e.g. the number of tags). */
export function IconWithCount({ icon, count, label }: { icon: ReactNode; count?: number; label?: string }): React.JSX.Element {
  return (
    <span className={styles.iconWrap}>
      {icon}
      {count !== undefined && count > 0 && <span className={styles.count}>{count}</span>}
      {label && <span className={styles.count}>{label}</span>}
    </span>
  )
}
