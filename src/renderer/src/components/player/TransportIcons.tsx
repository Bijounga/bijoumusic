interface IconProps {
  size: number
}

export function PlayIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function PauseIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  )
}

export function PreviousTrackIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="2.5" height="14" />
      <path d="M19 5v14l-9.5-7z" />
    </svg>
  )
}

export function NextTrackIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 5v14l9.5-7z" />
      <rect x="16.5" y="5" width="2.5" height="14" />
    </svg>
  )
}

export function DragHandleIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

export function ShuffleIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h3.5c2 0 3 1 4.2 3M3 18h3.5c2 0 3-1 4.2-3M14.5 6H21M14.5 18H21" />
      <path d="M18 3.5 21 6l-3 2.5M18 20.5 21 18l-3-2.5" />
    </svg>
  )
}
