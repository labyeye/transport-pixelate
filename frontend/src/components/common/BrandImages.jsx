import whatsapp from "@/assets/whatsapp.png";
import pixelateNest from "@/assets/pixelatenest.png";
import { cn } from "@/lib/utils";

/** Official WhatsApp mark (same asset Nest Play uses). */
export function WhatsAppIcon({ className }) {
  return (
    <img
      src={whatsapp}
      alt="WhatsApp"
      className={cn("object-contain inline-block w-4 h-4", className)}
    />
  );
}

/** Parent-company mark for "Powered by" footers. */
export function PoweredBy({ className }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-bold text-muted-foreground", className)}>
      Powered by
      <img src={pixelateNest} alt="Pixelate Nest" className="h-8 w-auto" />
    </span>
  );
}
