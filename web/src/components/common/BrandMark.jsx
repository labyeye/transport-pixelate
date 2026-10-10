import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";
/** Nest Transport wordmark; collapses to the icon chip in the collapsed sidebar. */
export function BrandMark({ collapsed }) {
  return (
    <>
      <div className={cn("flex items-center gap-2", collapsed && "lg:hidden")}>
        <div className="w-9 h-9 border-2 border-black bg-[#024BAB] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5 text-white" />
        </div>
        <span className="font-display font-bold text-lg leading-none text-black whitespace-nowrap">
          Nest <span className="text-[#FA731C]">Transport</span>
        </span>
      </div>
      <div
        className={cn(
          "hidden w-10 h-10 border-2 border-black bg-[#024BAB] items-center justify-center",
          collapsed && "lg:flex",
        )}
      >
        <Truck className="w-5 h-5 text-white" />
      </div>
    </>
  );
}
