import { motion, useReducedMotion } from "framer-motion";

/** Fades + slides children up on mount. Stagger a grid/list with delay={index * 0.06}. */
export function FadeIn({ children, delay = 0, distance = 12, duration = 0.4, className }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
