import type { FieldError } from "react-hook-form";

export function Field({ label, error, children, required }: { label: string; error?: FieldError | string; children: React.ReactNode; required?: boolean }) {
  const msg = typeof error === "string" ? error : error?.message;
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider mb-1">{label}{required && <span className="text-[#EF4444]"> *</span>}</span>
      {children}
      {msg && <span className="block text-xs font-semibold text-[#EF4444] mt-1">{msg}</span>}
    </label>
  );
}

export const inputCls = "nb-input w-full px-3 py-2 text-sm";
