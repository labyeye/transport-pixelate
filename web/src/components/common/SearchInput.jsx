import { Search } from "lucide-react";
export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 flex-1 min-w-48">
      <Search className="w-4 h-4 shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent text-sm outline-none w-full font-medium"
      />
    </div>
  );
}
export function FilterSelect({ value, onChange, options, all }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-2 border-black bg-white px-3 py-2 text-sm font-semibold outline-none"
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
