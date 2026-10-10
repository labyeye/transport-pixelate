import logoLong from "@/assets/logo_long.png";
import logoMini from "@/assets/logo_mini.png";
import { cn } from "@/lib/utils";

/** Nest Transport logo; collapses to the square mark in the collapsed sidebar. */
export function BrandMark({ collapsed, className }) {
  return (
    <>
      <img
        src={logoLong}
        alt="Nest Transport"
        className={cn("h-14 w-auto object-contain shrink-0", collapsed && "lg:hidden", className)}
      />
      <img
        src={logoMini}
        alt="Nest Transport"
        className={cn("hidden w-10 h-10 object-contain shrink-0", collapsed && "lg:block")}
      />
    </>
  );
}
