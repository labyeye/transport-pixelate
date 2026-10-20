import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/** Counts up to `value` on mount and whenever it changes (same effect as NestHR's AnimatedNumber). */
export function AnimatedNumber({ value, duration = 1, prefix = "", suffix = "", className }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? value : 0);
  const prev = useRef(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion || !Number.isFinite(value)) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduceMotion]);

  return (
    <span className={className}>
      {prefix}
      {Number.isFinite(value) ? display.toLocaleString() : String(value)}
      {suffix}
    </span>
  );
}
