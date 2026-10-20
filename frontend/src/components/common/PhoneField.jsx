import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  AE, AU, BD, BH, CA, GB, ID, IN, KE, KW, LK, MY, NG, NP, NZ, OM, PH, PK, QA, SA, SG, TH, US, ZA,
} from "country-flag-icons/react/3x2";
import { COUNTRIES, countryByIso } from "@/lib/countries";

// Named imports (not `import *`) so the bundle only carries the flags the list uses.
const FLAGS = { AE, AU, BD, BH, CA, GB, ID, IN, KE, KW, LK, MY, NG, NP, NZ, OM, PH, PK, QA, SA, SG, TH, US, ZA };

export function Flag({ iso, className = "w-6 h-4" }) {
  const F = FLAGS[iso];
  return F ? <F className={`${className} rounded-sm border border-black/30 shrink-0`} aria-hidden /> : null;
}

/** Country picker (flag + dial code) next to a national-number input. Controlled: value = { iso, number }. */
export function PhoneField({ id, value, onChange, error, onBlur }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef(null);
  const c = countryByIso(value.iso);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = COUNTRIES.filter((x) => `${x.name} ${x.dial} ${x.iso}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (iso) => {
    // A number typed for one country may be too long for the next.
    onChange({ iso, number: value.number.slice(0, countryByIso(iso).max) });
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative">
      <div
        className={`flex rounded-lg border-2 bg-white transition-colors ${error ? "border-red-500" : "border-black"}`}
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country code: ${c.name} +${c.dial}`}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 pl-3 pr-2 border-r-2 border-black text-sm font-bold shrink-0 rounded-l-md hover:bg-[#F0F6FF]"
        >
          <Flag iso={c.iso} />
          <span>+{c.dial}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          aria-invalid={!!error}
          value={value.number}
          onBlur={onBlur}
          onChange={(e) => onChange({ iso: value.iso, number: e.target.value.replace(/\D/g, "").slice(0, c.max) })}
          placeholder={"9".repeat(c.max)}
          className="flex-1 min-w-0 px-3 py-3 text-sm font-medium bg-transparent outline-none rounded-r-lg !border-0 !shadow-none"
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-72 max-w-[90vw] rounded-lg overflow-hidden border-2 border-black bg-white shadow-[4px_4px_0px_#0a0a0a]">
          <div className="flex items-center gap-2 px-3 border-b-2 border-black">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search country"
              className="w-full py-2 text-sm outline-none !border-0 !shadow-none"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-auto">
            {list.map((x) => (
              <li key={x.iso}>
                <button
                  type="button"
                  role="option"
                  aria-selected={x.iso === c.iso}
                  onClick={() => pick(x.iso)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#F0F6FF]"
                >
                  <Flag iso={x.iso} />
                  <span className="flex-1 font-semibold truncate">{x.name}</span>
                  <span className="text-gray-500">+{x.dial}</span>
                  {x.iso === c.iso && <Check className="w-4 h-4 text-[#024BAB]" />}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-3 text-sm text-gray-500">No country found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
