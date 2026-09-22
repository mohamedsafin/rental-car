/**
 * components/PageHeader.tsx
 * ---------------------------------------------------------------------------
 * The top of every interior page: an optional back link, an eyebrow, the page
 * title as the one <h1>, a line of context and optional actions on the right.
 *
 * One component so that every page opens the same way - the same type scale,
 * the same spacing to the content below - which is most of what makes a set
 * of pages feel like one site.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  eyebrow?: string;
  /** May contain a `<span className="font-editorial">` accent. */
  title: ReactNode;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}

export default function PageHeader({ eyebrow, title, description, back, actions }: PageHeaderProps) {
  return (
    <header>
      {back && (
        <Link
          to={back.to}
          className="group mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-950"
        >
          <ArrowLeft
            aria-hidden
            className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-0.5"
          />
          {back.label}
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
          <h1 className={`display-heading text-[2.25rem] sm:text-5xl ${eyebrow ? 'mt-4' : ''}`}>
            {title}
          </h1>
          {description && (
            <div className="mt-3 text-[15px] leading-relaxed text-ink-500 sm:text-base">
              {description}
            </div>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
