import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  /** Hex accent colour used for the icon chip. */
  color?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

/**
 * Summary / status card used at the top of list pages — same look as the
 * Students page (bordered icon chip + uppercase label + big number).
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  color = "#024BAB",
  onClick,
  active,
  className,
}: StatCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "border-2 border-black bg-white p-4 flex items-center gap-3 text-left",
        onClick &&
          "transition-shadow hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
        active && "shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
        className,
      )}
      style={active ? { backgroundColor: `${color}12` } : undefined}
    >
      <div
        className="w-10 h-10 border-2 flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}1A`, borderColor: color }}
      >
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </p>
        <p className="text-2xl font-bold text-black">{value}</p>
      </div>
    </Tag>
  );
}
