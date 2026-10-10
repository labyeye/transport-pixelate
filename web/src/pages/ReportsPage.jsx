import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Download, Info } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/DataTable";
import { Field, inputCls } from "@/components/common/Field";
import { useToast } from "@/hooks/use-toast";
import { downloadFile, get } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatCurrency, formatDate } from "@/lib/utils";

const ymd = (d) => d.toLocaleDateString("en-CA");
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));
const TRIP_CHARTS = ["trips_daily", "trips_monthly"];

function fmt(col, v) {
  if (v == null || v === "")
    return col.type === "number" || col.type === "money" ? (
      <span title="No data / not enough data" className="text-muted-foreground">
        —
      </span>
    ) : (
      ""
    );
  if (col.type === "money") return formatCurrency(v);
  if (col.type === "date")
    return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatDate(v) : String(v);
  if (col.type === "number")
    return typeof v === "number" ? v.toLocaleString("en-IN") : v;
  return String(v).replace(/_/g, " ");
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(ymd(new Date()));
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const catalog = useQuery({
    queryKey: ["report-catalog"],
    queryFn: async () => (await get("/reports")).data,
  });
  useEffect(() => {
    if (!key && catalog.data?.length) setKey(catalog.data[0].key);
  }, [catalog.data, key]);
  const current = catalog.data?.find((r) => r.key === key);
  const params = { from, to, page, limit: 50 };
  const report = useQuery({
    queryKey: ["report", key, from, to, page],
    queryFn: () => get(`/reports/${key}`, params),
    enabled: !!key && from <= to,
    placeholderData: (p) => p,
  });
  const groups = useMemo(
    () => [...new Set((catalog.data ?? []).map((r) => r.group))],
    [catalog.data],
  );
  const data = report.data?.data;
  const meta = report.data?.meta;

  const exportCsv = async () => {
    setBusy(true);
    try {
      const qs = current.usesDateRange ? `?from=${from}&to=${to}` : "";
      await downloadFile(
        `/reports/${key}/export.csv${qs}`,
        `${key}${current.usesDateRange ? `_${from}_${to}` : ""}.csv`,
      );
    } catch (e) {
      toast({
        title: "Export failed",
        description: errMsg(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (catalog.isLoading)
    return (
      <AppLayout title="Reports">
        <div className="h-40 border-2 border-black bg-white animate-pulse" />
      </AppLayout>
    );
  if (!catalog.data?.length)
    return (
      <AppLayout title="Reports">
        <PageHeader title="Reports" />
        <EmptyState
          icon={BarChart3}
          title="No reports available"
          message="Your role doesn't have access to any reports."
        />
      </AppLayout>
    );

  return (
    <AppLayout title="Reports">
      <PageHeader
        title="Reports & analytics"
        subtitle="Calculated from your records; blanks mean there isn't enough data to say"
        actions={
          <PrimaryButton disabled={busy || !data} onClick={exportCsv}>
            <Download className="w-4 h-4" />{" "}
            {busy ? "Preparing…" : "Export CSV"}
          </PrimaryButton>
        }
      />
      <div className="grid lg:grid-cols-[220px_1fr] gap-4">
        <nav
          aria-label="Reports"
          className="border-2 border-black bg-white self-start"
        >
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {g}
              </p>
              {catalog.data
                .filter((r) => r.group === g)
                .map((r) => (
                  <button
                    key={r.key}
                    onClick={() => {
                      setKey(r.key);
                      setPage(1);
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm font-semibold border-l-4 ${key === r.key ? "bg-[#024BAB] text-white border-[#FA731C]" : "border-transparent hover:bg-[#024BAB]/10"}`}
                  >
                    {r.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <section className="min-w-0">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <h2 className="text-lg font-bold mr-auto">{current?.label}</h2>
            {current?.usesDateRange ? (
              <>
                <Field label="From">
                  <input
                    type="date"
                    className={inputCls}
                    value={from}
                    max={to}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
                <Field label="To">
                  <input
                    type="date"
                    className={inputCls}
                    value={to}
                    min={from}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
                <div className="flex gap-1">
                  {[
                    ["7 days", 6],
                    ["30 days", 29],
                    ["90 days", 89],
                  ].map(([l, n]) => (
                    <button
                      key={l}
                      onClick={() => {
                        setFrom(daysAgo(n));
                        setTo(ymd(new Date()));
                        setPage(1);
                      }}
                      className="border-2 border-black bg-white px-2 py-2 text-xs font-bold"
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground font-medium">
                As of today — date range doesn't apply.
              </p>
            )}
          </div>
          {report.error && (
            <div
              role="alert"
              className="border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700 mb-3"
            >
              {errMsg(report.error)}
            </div>
          )}
          {report.isLoading && (
            <div className="h-48 border-2 border-black bg-white animate-pulse" />
          )}
          {data && (
            <>
              {TRIP_CHARTS.includes(key) && data.rows.length > 0 && (
                <div
                  className="border-2 border-black bg-white p-3 mb-4"
                  style={{ height: 260 }}
                  aria-label="Trips chart"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.rows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="completed"
                        stackId="a"
                        name="Completed"
                        fill="#00C48C"
                      />
                      <Bar
                        dataKey="inProgress"
                        stackId="a"
                        name="In progress"
                        fill="#FA731C"
                      />
                      <Bar
                        dataKey="upcoming"
                        stackId="a"
                        name="Upcoming"
                        fill="#024BAB"
                      />
                      <Bar
                        dataKey="delayed"
                        stackId="a"
                        name="Delayed"
                        fill="#FFD60A"
                      />
                      <Bar
                        dataKey="cancelled"
                        stackId="a"
                        name="Cancelled"
                        fill="#EF4444"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="No data for this period"
                  message="Nothing matched the selected dates."
                />
              ) : (
                <div className="border-2 border-black bg-white overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-black bg-[#024BAB]/5">
                        {data.columns.map((c) => (
                          <th
                            key={c.key}
                            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${c.type === "number" || c.type === "money" ? "text-right" : "text-left"}`}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-black/10 last:border-0 hover:bg-[#024BAB]/[0.03]"
                        >
                          {data.columns.map((c) => (
                            <td
                              key={c.key}
                              className={`px-4 py-2.5 ${c.type === "number" || c.type === "money" ? "text-right tabular-nums" : ""}`}
                            >
                              {fmt(c, r[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {data.totals && (!meta || meta.page === meta.pages) && (
                        <tr className="border-t-2 border-black bg-[#024BAB]/5 font-bold">
                          {data.columns.map((c) => (
                            <td
                              key={c.key}
                              className={`px-4 py-2.5 ${c.type === "number" || c.type === "money" ? "text-right tabular-nums" : ""}`}
                            >
                              {data.totals[c.key] != null
                                ? fmt(c, data.totals[c.key])
                                : ""}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {meta?.pages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm font-semibold">
                  <span className="text-muted-foreground">
                    {meta.total} rows
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                      className="border-2 border-black bg-white px-3 py-1 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span>
                      Page {meta.page} of {meta.pages}
                    </span>
                    <button
                      disabled={page >= meta.pages}
                      onClick={() => setPage(page + 1)}
                      className="border-2 border-black bg-white px-3 py-1 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              {data.truncated && (
                <p className="text-xs font-bold text-red-700 mt-2">
                  Results were cut off at the report limit. Choose a shorter
                  date range.
                </p>
              )}
              {data.notes.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {data.notes.map((n, i) => (
                    <li
                      key={i}
                      className="text-xs text-muted-foreground font-medium flex gap-1.5"
                    >
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {n}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground font-medium mt-2">
                {data.range
                  ? `${data.range.from} to ${data.range.to} (${data.range.timezone}) · `
                  : ""}
                generated {new Date(data.generatedAt).toLocaleString("en-IN")}
              </p>
            </>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
