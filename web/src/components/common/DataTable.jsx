import { ChevronLeft, ChevronRight } from "lucide-react";
export function DataTable({ columns, rows, loading, meta, onPage, empty }) {
  if (loading) {
    return (
      <div className="border-2 border-black bg-white">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-12 border-b border-black/10 last:border-0 animate-pulse bg-[#024BAB]/[0.03]"
          />
        ))}
      </div>
    );
  }
  if (!rows.length) return <>{empty}</>;
  return (
    <div>
      <div className="border-2 border-black bg-white overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-black bg-[#024BAB]/5">
              {columns.map((c) => (
                <th
                  key={c.header}
                  className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider whitespace-nowrap"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r._id}
                className="border-b border-black/10 last:border-0 hover:bg-[#024BAB]/[0.03]"
              >
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-3 text-black ${c.className ?? ""}`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm font-semibold">
          <span className="text-muted-foreground">{meta.total} total</span>
          <div className="flex items-center gap-2">
            <button
              disabled={meta.page <= 1}
              onClick={() => onPage(meta.page - 1)}
              className="border-2 border-black bg-white p-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {meta.page} of {meta.pages}
            </span>
            <button
              disabled={meta.page >= meta.pages}
              onClick={() => onPage(meta.page + 1)}
              className="border-2 border-black bg-white p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="border-2 border-dashed border-black/40 bg-white p-10 flex flex-col items-center text-center gap-2">
      <div className="w-12 h-12 border-2 border-black bg-[#024BAB]/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-[#024BAB]" />
      </div>
      <p className="font-bold text-black">{title}</p>
      <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
