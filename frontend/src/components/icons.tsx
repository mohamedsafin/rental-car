/**
 * components/icons.tsx
 * ---------------------------------------------------------------------------
 * The handful of inline SVG icons the customer site uses.
 *
 * Inline rather than an icon library because we need six glyphs, and pulling
 * in a package for that would add a dependency, a bundle, and a version to
 * keep current - for six shapes that will never change.
 *
 * Every icon is `aria-hidden`: each one sits beside a text label that already
 * says what it means, so announcing it again would just make a screen reader
 * read "seats seats".
 */
interface IconProps {
  className?: string;
}

function base(className?: string) {
  return {
    className,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function SeatIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 4v8a3 3 0 0 0 3 3h5" />
      <path d="M6 19h11a3 3 0 0 0 3-3v-1" />
      <path d="M6 15v4" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 4v16M18 4v16M6 12h12" />
      <circle cx="6" cy="4" r="1.6" />
      <circle cx="18" cy="4" r="1.6" />
      <circle cx="6" cy="20" r="1.6" />
    </svg>
  );
}

export function FuelIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14" />
      <path d="M3 20h11" />
      <path d="M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" />
      <path d="M6 9h5" />
    </svg>
  );
}

export function DoorIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M5 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15" />
      <path d="M3 20h18" />
      <circle cx="13" cy="12" r="1" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function TagIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
