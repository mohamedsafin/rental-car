/**
 * pages/LegalPage.tsx
 * ---------------------------------------------------------------------------
 * Terms, privacy and policy pages (BRD 45-47).
 *
 * Public and unauthenticated, deliberately. Terms you have to sign in to read
 * are terms you cannot read before deciding whether to sign up.
 *
 * The version and effective date are shown at the top. That is not decoration:
 * these documents are versioned, a booking records which version was live when
 * it was made, and a customer should be able to see which one they are looking
 * at.
 */
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface LegalDocument {
  id: string;
  type: string;
  version: number;
  title: string;
  content: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
}

const SLUG_TO_TYPE: Record<string, string> = {
  terms: 'TERMS_AND_CONDITIONS',
  privacy: 'PRIVACY_POLICY',
  'rental-agreement': 'RENTAL_AGREEMENT',
  cancellation: 'CANCELLATION_POLICY',
  refunds: 'REFUND_POLICY',
};

/**
 * A deliberately small Markdown renderer: headings, bold, lists, paragraphs.
 *
 * Not a library, and not `dangerouslySetInnerHTML`. The content is written by
 * an admin, but "written by someone we trust" is exactly the assumption that
 * turns a CMS field into stored XSS the first time an account is compromised.
 * Every line here becomes a React element, so nothing in the text can become
 * markup.
 */
function Markdown({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={index} className="pt-4 text-base font-semibold text-ink-950">
              {trimmed.slice(4)}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={index} className="pt-8 text-xl font-semibold tracking-tight text-ink-950">
              {trimmed.slice(3)}
            </h2>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={index} className="pt-8 text-2xl font-semibold tracking-tight text-ink-950">
              {trimmed.slice(2)}
            </h2>
          );
        }

        const lines = trimmed.split('\n');
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-2 pl-5 text-[15px] leading-7 text-ink-600 marker:text-ink-300">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^\s*[-*]\s+/, '')}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="text-[15px] leading-7 text-ink-600">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export default function LegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const type = SLUG_TO_TYPE[slug ?? ''];

  const { data, isPending, isError, error } = useQuery<LegalDocument, NormalisedApiError>({
    queryKey: ['legal', type],
    queryFn: () => getData<LegalDocument>(`/legal/${type}`),
    enabled: Boolean(type),
    retry: false,
  });

  if (!type) {
    return (
      <div className="page-container pt-14">
        <div className="mx-auto max-w-2xl rounded-card border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-lg font-semibold text-ink-950">Unknown document</p>
          <Link to="/" className="link-arrow mt-3">
            Back to the home page
          </Link>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="page-container pt-14" aria-busy="true">
        <div className="mx-auto max-w-3xl animate-pulse space-y-4">
          <div className="h-12 w-2/3 rounded-lg bg-ink-100" />
          <div className="h-80 rounded-card bg-ink-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-container pt-14">
        <div className="mx-auto max-w-2xl rounded-card border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-lg font-semibold text-ink-950">
            {error.status === 404 ? 'Not published yet' : 'Could not load this document'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            {error.status === 404
              ? 'This policy has not been published. Please contact us if you need a copy before booking.'
              : error.message}
          </p>
          <Link to="/" className="link-arrow mt-5">
            Back to the home page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container pt-10 sm:pt-14">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-ink-100 pb-8">
          <p className="section-eyebrow">Legal</p>
          <h1 className="display-heading mt-4 text-[2.25rem] sm:text-5xl">{data.title}</h1>
          <p className="tabular mt-4 text-sm text-ink-500">
            Version {data.version}
            {data.effectiveFrom ? ` · in effect from ${data.effectiveFrom.slice(0, 10)}` : ''}
          </p>
        </header>

        <div className="mt-8">
          <Markdown content={data.content} />
        </div>

        <p className="mt-14 border-t border-ink-100 pt-6 text-xs leading-relaxed text-ink-500">
          Your booking records the version of this document that was live when you made it, so what
          you agreed to does not change when this page does.
        </p>
      </article>
    </div>
  );
}
