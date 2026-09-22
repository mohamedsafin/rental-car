/**
 * components/motion/Reveal.tsx
 * ---------------------------------------------------------------------------
 * Fades content up into place the first time it scrolls into view.
 *
 * The numbers are deliberately small: 20px of travel over 600ms on the shared
 * "premium" curve. Enough that sections feel like they settle as you arrive at
 * them; any more and the page reads as a slideshow you are waiting for.
 *
 * `once: true` because content that re-animates every time you scroll past it
 * is a distraction the second time. The layout wraps the app in
 * <MotionConfig reducedMotion="user">, so anyone who has asked their OS for
 * less motion gets the fade without the travel.
 */
import type { ReactNode } from 'react';
import { motion } from 'motion/react';

const TAGS = {
  div: motion.div,
  li: motion.li,
  section: motion.section,
  article: motion.article,
} as const;

interface RevealProps {
  as?: keyof typeof TAGS;
  /** Seconds. Use small steps (0.06-0.1) to stagger siblings. */
  delay?: number;
  /** Pixels of upward travel. */
  y?: number;
  className?: string;
  id?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}

export default function Reveal({ as = 'div', delay = 0, y = 20, className, children, ...rest }: RevealProps) {
  // Every entry in TAGS takes the same motion props; the cast only tells
  // TypeScript to stop treating the union of element types as incompatible.
  const Tag = TAGS[as] as typeof motion.div;

  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
