import logoLong from "@/assets/logo_long.png";
import logoMini from "@/assets/logo_mini.png";
import { cn } from "@/lib/utils";

/** Nest Transport logo; collapses to the square mark in the collapsed sidebar. */
export function BrandMark({ collapsed }) {
  return (
    <>
      <img
        src={logoLong}
        alt="Nest Transport"
        className={cn("h-10 w-auto object-contain", collapsed && "lg:hidden")}
      />
      <img
        src={logoMini}
        alt="Nest Transport"
        className={cn("hidden w-10 h-10 object-contain", collapsed && "lg:block")}
      />
    </>
  );
}
