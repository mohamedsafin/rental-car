/**
 * components/SectionHeading.tsx
 * ---------------------------------------------------------------------------
 * The header block above a page section: a small eyebrow, a title, an optional
 * one-line description and an optional link on the right.
 *
 * It exists because the same fifteen utility classes were being retyped above
 * every section, and they had already started to drift - one section's title
 * was a different size to the next, and the "View all" link sat at a different
 * height depending on whether the section had a description. Centralising it
 * makes that class of misalignment impossible rather than merely unlikely.
 *
 * `accent` is an optional closing phrase set in the italic editorial serif -
 * "Rental, without the *surprises.*" - which is the one typographic flourish a
 * section gets. It stays near-black: the orange is reserved for the hero.
 *
 * `id` is threaded onto the <h2> so a section can point `aria-labelledby` at
 * it, which is what gives a screen reader the section's name.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

interface SectionHeadingProps {
  id?: string;
  /** Small uppercase label above the title. Optional. */
  eyebrow?: string;
  title: string;
  /** A closing phrase rendered in the editorial italic serif. */
  accent?: string;
  description?: string;
  /** An understated link rendered on the right, aligned to the title block. */
  action?: { to: string; label: string };
  /**
   * `lg` is the display size for landing sections; `md` is for interior pages,
   * where a title competes with a filter bar rather than with a hero.
   */
  size?: 'md' | 'lg';
}

export default function SectionHeading({
  id,
  eyebrow,
  title,
  accent,
  description,
  action,
  size = 'md',
}: SectionHeadingProps) {
  const titleSize =
    size === 'lg'
      ? 'text-[2rem] sm:text-[2.75rem] lg:text-[3.25rem]'
      : 'text-2xl sm:text-[1.875rem]';

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
      <div className="max-w-2xl">
        {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
        <h2 id={id} className={`display-heading ${eyebrow ? 'mt-4' : ''} ${titleSize}`}>
          {title}
          {accent && (
            <>
              {' '}
              <span className="font-editorial">{accent}</span>
            </>
          )}
        </h2>
        {description && (
          <p
            className={`max-w-xl text-ink-500 ${size === 'lg' ? 'mt-4 text-base leading-relaxed sm:text-[17px]' : 'mt-2 text-sm'}`}
          >
            {description}
          </p>
        )}
      </div>

      {action && (
        <Link to={action.to} className="link-arrow shrink-0">
          {action.label}
          <ArrowRight aria-hidden className="link-arrow-icon h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
