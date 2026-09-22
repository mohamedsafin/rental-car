/**
 * components/icons.tsx
 * ---------------------------------------------------------------------------
 * The customer site's named icons, backed by Lucide.
 *
 * This file used to hand-draw a dozen SVGs to avoid a dependency. The redesign
 * brought Lucide in anyway (a consistent 1.75px line family across the whole
 * interface is a large part of what makes it look designed), so these are now
 * thin wrappers. The export NAMES are unchanged on purpose: every existing
 * `import { SeatIcon } from './icons'` keeps working, and new code can import
 * from `lucide-react` directly.
 *
 * Every icon is `aria-hidden`: each one sits beside a text label that already
 * says what it means, so announcing it again would make a screen reader read
 * "seats seats".
 */
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CarFront,
  Check,
  Clock,
  Cog,
  DoorOpen,
  Fuel,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';

interface IconProps {
  className?: string;
}

function make(Icon: typeof ArrowRight) {
  return function NamedIcon({ className }: IconProps) {
    return <Icon aria-hidden className={className} strokeWidth={1.75} />;
  };
}

export const SeatIcon = make(Users);
export const GearIcon = make(Cog);
export const FuelIcon = make(Fuel);
export const DoorIcon = make(DoorOpen);
export const CalendarIcon = make(CalendarDays);
export const PinIcon = make(MapPin);
export const ShieldIcon = make(ShieldCheck);
export const ClockIcon = make(Clock);
export const TagIcon = make(Tag);
export const SearchIcon = make(Search);
export const MenuIcon = make(Menu);
export const CloseIcon = make(X);
export const ArrowRightIcon = make(ArrowRight);
export const CheckIcon = make(Check);
export const BadgeCheckIcon = make(BadgeCheck);
export const CarIcon = make(CarFront);
export const WalletIcon = make(Wallet);
