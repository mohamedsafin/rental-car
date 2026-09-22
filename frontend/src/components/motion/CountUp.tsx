/**
 * components/motion/CountUp.tsx
 * ---------------------------------------------------------------------------
 * A whole number that counts up from zero when it first becomes visible.
 *
 * Only ever given REAL counts from the API (fleet size, categories, pickup
 * points) - an animated number is persuasive, which is exactly why it must
 * never be an invented one.
 *
 * Screen readers get the final value once, from a visually hidden copy; the
 * animating digits are hidden from them, so nobody hears "1, 4, 9, 17, 30".
 */
import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';

export default function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    return () => controls.stop();
  }, [inView, value, reduceMotion]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
