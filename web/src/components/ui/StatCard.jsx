import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { FadeIn } from "@/components/motion/FadeIn";

/**
 * Summary / status card used at the top of list pages (NestHR look): solid icon chip, big
 * counting-up number, uppercase label, hard shadow that lifts on hover and presses on click.
 * Numeric values count up; anything else (₹ strings etc.) renders as given.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  color = "#024BAB",
  onClick,
  active,
  sub,
  delay = 0,
  className,
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <FadeIn delay={delay} className={cn("min-w-0", className)}>
      <Tag
        onClick={onClick}
        className={cn(
          "w-full rounded-lg border-2 border-black bg-white p-4 flex items-center gap-3 text-left",
          onClick &&
            "transition-all duration-150 ease-out hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-px hover:-translate-y-px active:translate-x-0 active:translate-y-0 active:shadow-none",
          active && "shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
        )}
        style={active ? { backgroundColor: `${color}12` } : undefined}
      >
        <div
          className="w-10 h-10 rounded-lg border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center shrink-0"
          style={{ backgroundColor: color }}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-black leading-tight">
            {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
          </p>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          {sub ? <p className="text-xs text-muted-foreground truncate">{sub}</p> : null}
        </div>
      </Tag>
    </FadeIn>
  );
}
