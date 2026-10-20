import { Archive, Fuel, Gauge, Pencil, UserCheck, Users } from "lucide-react";
import { StatusBadge, VEHICLE_STATUS } from "@/components/common/StatusBadge";
import { cn } from "@/lib/utils";

// Drop vehicle photos (png/jpg/webp) into src/assets/vehicles and they are picked up automatically.
const PHOTOS = Object.values(
  import.meta.glob("../../assets/vehicles/*.{png,jpg,jpeg,webp,avif}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
);
const DOC_KEYS = ["insurance", "registration", "fitness", "permit", "pollution"];
const PALETTE = ["#FA731C", "#024BAB", "#00C48C", "#A855F7", "#F59E0B", "#EF4444"];

// Stable pseudo-random pick, so a vehicle keeps the same picture between renders and reloads.
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function TruckArt({ color }) {
  return (
    <svg viewBox="0 0 320 120" className="w-full h-full" role="img" aria-label="Vehicle">
      <rect x="6" y="18" width="190" height="70" rx="6" fill={color} stroke="#0A0A0A" strokeWidth="3" />
      <path d="M196 38h58l30 28v22h-88z" fill="#fff" stroke="#0A0A0A" strokeWidth="3" />
      <path d="M208 46h38l20 20h-58z" fill="#BFD8FF" stroke="#0A0A0A" strokeWidth="2" />
      <rect x="0" y="88" width="290" height="6" fill="#0A0A0A" />
      {[60, 118, 232].map((x) => (
        <g key={x}>
          <circle cx={x} cy="96" r="14" fill="#0A0A0A" />
          <circle cx={x} cy="96" r="5" fill="#fff" />
        </g>
      ))}
    </svg>
  );
}

export function timeAgo(date) {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const units = [
    [60, "min"],
    [3600, "hr"],
    [86400, "day"],
  ];
  let out = "1 min";
  for (const [size, label] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      out = `${n} ${label}${n > 1 && label === "day" ? "s" : ""}`;
    }
  }
  return `${out} ago`;
}

/** Share of the five compliance documents that are on file and not yet expired. */
function docHealth(v) {
  const now = Date.now();
  const valid = DOC_KEYS.filter((k) => {
    const d = v.documents?.[k]?.expiryDate;
    return d && new Date(d).getTime() >= now;
  }).length;
  return { valid, total: DOC_KEYS.length };
}

export function VehicleCard({ vehicle: v, canWrite, onEdit, onAssign, onArchive, onStatus }) {
  const h = hash(v._id ?? v.registrationNumber);
  const photo = PHOTOS.length ? PHOTOS[h % PHOTOS.length] : null;
  const title = [v.make, v.model].filter(Boolean).join(" ") || `${v.category} ${v.fleetNumber ?? ""}`.trim();
  const { valid, total } = docHealth(v);
  const pct = Math.round((valid / total) * 100);
  const driver = v.assignedDriver?.name;
  const initials = driver
    ? driver
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "—";

  return (
    <article className="group bg-white rounded-lg border-2 border-black p-4 flex flex-col transition-all hover:border-[#FA731C] hover:shadow-[4px_4px_0px_#0a0a0a]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-black truncate">{title}</h3>
          <p className="text-xs text-gray-500 font-medium">{v.registrationNumber}</p>
        </div>
        <StatusBadge meta={VEHICLE_STATUS[v.status]} />
      </div>

      <div className="my-3 h-28 flex items-center justify-center">
        {photo ? (
          <img src={photo} alt={title} loading="lazy" className="max-h-full max-w-full object-contain" />
        ) : (
          <TruckArt color={PALETTE[h % PALETTE.length]} />
        )}
      </div>

      <div className="flex items-center gap-2.5 mb-3">
        <div
          className={cn(
            "w-8 h-8 rounded-full border-2 border-black flex items-center justify-center text-[11px] font-bold shrink-0",
            driver ? "bg-[#024BAB] text-white" : "bg-gray-100 text-gray-400",
          )}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide leading-none">Driver</p>
          <p className="text-sm font-bold text-black truncate">{driver ?? "Unassigned"}</p>
        </div>
        <p className="text-[10px] text-gray-400 font-medium text-right shrink-0">
          Last update: {timeAgo(v.updatedAt)}
        </p>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
          <span>Documents valid</span>
          <span>
            {valid}/{total}
          </span>
        </div>
        <div
          className="h-2 rounded-full bg-gray-100 border border-black/20 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Documents valid"
        >
          <div
            className={cn("h-full rounded-full", pct === 100 ? "bg-[#00C48C]" : pct >= 60 ? "bg-[#FA731C]" : "bg-[#EF4444]")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between text-xs font-semibold text-gray-600">
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {v.capacity} seats
        </span>
        <span className="flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5" />
          {(v.odometer ?? 0).toLocaleString("en-IN")} km
        </span>
        <span className="flex items-center gap-1.5 capitalize">
          <Fuel className="w-3.5 h-3.5" />
          {v.fuelType}
        </span>
      </div>

      {canWrite && (
        <div className="mt-3 pt-3 border-t-2 border-black/10 flex items-center gap-1.5">
          <button
            title="Edit"
            aria-label={`Edit ${v.registrationNumber}`}
            onClick={onEdit}
            className="rounded-lg border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            title="Assign driver"
            aria-label={`Assign driver to ${v.registrationNumber}`}
            onClick={onAssign}
            className="rounded-lg border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
          >
            <UserCheck className="w-3.5 h-3.5" />
          </button>
          <select
            aria-label={`Change status of ${v.registrationNumber}`}
            value=""
            onChange={(e) => e.target.value && onStatus(e.target.value)}
            className="min-w-0 rounded-lg border-2 border-black bg-white text-xs font-bold px-1.5 py-1.5"
          >
            <option value="">Set status…</option>
            <option value="available">Available</option>
            <option value="maintenance">Maintenance</option>
            <option value="out_of_service">Out of service</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            title="Archive"
            aria-label={`Archive ${v.registrationNumber}`}
            onClick={onArchive}
            className="ml-auto rounded-lg border-2 border-black p-1.5 hover:bg-red-50"
          >
            <Archive className="w-3.5 h-3.5 text-red-600" />
          </button>
        </div>
      )}
    </article>
  );
}
