import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Fuel, Plus, Receipt, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, post } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatCurrency, formatDateOrDash } from "@/lib/utils";

const CATS = [
  "toll",
  "parking",
  "repair",
  "insurance",
  "permit_fee",
  "fine",
  "tyres",
  "cleaning",
  "other",
];
const ES = {
  pending: { label: "Pending", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};
const nowLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const useVehicles = () =>
  useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });

// A fresh clientRef per opened form protects against double clicks and retries of the same submission.
const newRef = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);

function FuelForm({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const vehicles = useVehicles();
  const [ref] = useState(newRef);
  const [f, setF] = useState({
    vehicle: "",
    filledAt: nowLocal(),
    quantity: "",
    pricePerUnit: "",
    odometer: "",
    fullTank: false,
    station: "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const total =
    f.quantity && f.pricePerUnit
      ? Math.round(f.quantity * f.pricePerUnit * 100) / 100
      : null;
  const save = useMutation({
    mutationFn: () =>
      post("/fuel", {
        ...f,
        filledAt: new Date(f.filledAt).toISOString(),
        station: f.station || undefined,
        clientRef: ref,
      }),
    onSuccess: () => {
      ["fuel", "dashboard", "vehicles"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: "Fuel recorded", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Record fuel" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
          >
            {error}
          </div>
        )}
        <Field label="Vehicle" required>
          <select
            required
            className={inputCls}
            value={f.vehicle}
            onChange={set("vehicle")}
          >
            <option value="">Select…</option>
            {vehicles.data?.map((v) => (
              <option key={v._id} value={v._id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Filled at" required>
          <input
            required
            type="datetime-local"
            className={inputCls}
            value={f.filledAt}
            onChange={set("filledAt")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" required>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              className={inputCls}
              value={f.quantity}
              onChange={set("quantity")}
            />
          </Field>
          <Field label="Price per unit (₹)" required>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={f.pricePerUnit}
              onChange={set("pricePerUnit")}
            />
          </Field>
        </div>
        <p className="text-sm font-bold">
          Total: {total != null ? formatCurrency(total) : "—"}{" "}
          <span className="text-xs text-muted-foreground font-medium">
            (calculated and checked by the server)
          </span>
        </p>
        <Field label="Odometer (km)" required>
          <input
            required
            type="number"
            min={0}
            className={inputCls}
            value={f.odometer}
            onChange={set("odometer")}
          />
        </Field>
        <Field label="Fuel station">
          <input
            className={inputCls}
            value={f.station}
            onChange={set("station")}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={f.fullTank}
            onChange={(e) => setF({ ...f, fullTank: e.target.checked })}
          />{" "}
          Filled to full tank (needed to measure mileage)
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>Save</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ExpenseForm({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const vehicles = useVehicles();
  const [ref] = useState(newRef);
  const [f, setF] = useState({
    category: "toll",
    vehicle: "",
    amount: "",
    date: new Date().toLocaleDateString("en-CA"),
    vendor: "",
    paymentMethod: "cash",
    notes: "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      post("/expenses", {
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
        clientRef: ref,
      }),
    onSuccess: () => {
      ["expenses", "dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: "Expense submitted for approval", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Submit expense" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
          >
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              className={inputCls}
              value={f.category}
              onChange={set("category")}
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (₹)" required>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              className={inputCls}
              value={f.amount}
              onChange={set("amount")}
            />
          </Field>
          <Field label="Date" required>
            <input
              required
              type="date"
              className={inputCls}
              value={f.date}
              onChange={set("date")}
            />
          </Field>
          <Field label="Payment">
            <select
              className={inputCls}
              value={f.paymentMethod}
              onChange={set("paymentMethod")}
            >
              {["cash", "card", "upi", "bank", "other"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Vehicle">
          <select
            className={inputCls}
            value={f.vehicle}
            onChange={set("vehicle")}
          >
            <option value="">Not vehicle-specific</option>
            {vehicles.data?.map((v) => (
              <option key={v._id} value={v._id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendor">
          <input
            className={inputCls}
            value={f.vendor}
            onChange={set("vendor")}
          />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={f.notes} onChange={set("notes")} />
        </Field>
        <p className="text-xs text-muted-foreground font-medium">
          Receipt uploads arrive with document storage (a later phase).
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>Submit</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ReviewDialog({ expense, decision, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: () =>
      post(`/expenses/${expense._id}/review`, {
        decision,
        note: note || undefined,
      }),
    onSuccess: () => {
      ["expenses", "dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: `Expense ${decision}`, variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={`${decision === "approved" ? "Approve" : "Reject"} ${formatCurrency(expense.amount)}`}
      onClose={onClose}
    >
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <Field
        label={decision === "rejected" ? "Reason" : "Note (optional)"}
        required={decision === "rejected"}
      >
        <input
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Back
        </button>
        <button
          disabled={m.isPending || (decision === "rejected" && !note.trim())}
          onClick={() => m.mutate()}
          className={`border-2 border-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${decision === "approved" ? "bg-[#024BAB]" : "bg-[#EF4444]"}`}
        >
          {decision === "approved" ? "Approve" : "Reject"}
        </button>
      </div>
    </Modal>
  );
}

function Costs() {
  const [range, setRange] = useState({
    from: new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA"),
    to: new Date().toLocaleDateString("en-CA"),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["costs", range],
    queryFn: async () =>
      (
        await get("/expenses/costs/summary", {
          from: new Date(`${range.from}T00:00:00`).toISOString(),
          to: new Date(`${range.to}T23:59:59`).toISOString(),
        })
      ).data,
  });
  return (
    <div>
      <div className="flex gap-2 mb-3 items-end">
        <Field label="From">
          <input
            type="date"
            className={inputCls}
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={inputCls}
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </Field>
      </div>
      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard
            label="Fuel"
            value={formatCurrency(data.totals.fuel)}
            icon={Fuel}
          />
          <StatCard
            label="Maintenance"
            value={formatCurrency(data.totals.maintenance)}
            icon={Receipt}
            color="#D97706"
          />
          <StatCard
            label="Approved expenses"
            value={formatCurrency(data.totals.expenses)}
            icon={Receipt}
            color="#FA731C"
          />
        </div>
      )}
      <DataTable
        loading={isLoading}
        rows={(data?.rows ?? []).map((r) => ({
          ...r,
          _id: String(r.vehicleId ?? "none"),
        }))}
        onPage={() => {}}
        empty={
          <EmptyState
            icon={Receipt}
            title="No costs in this period"
            message="Fuel fills, completed maintenance and approved expenses appear here."
          />
        }
        columns={[
          {
            header: "Vehicle",
            cell: (r) => (
              <span className="font-bold">{r.registrationNumber}</span>
            ),
          },
          { header: "Fuel", cell: (r) => formatCurrency(r.fuel) },
          { header: "Maintenance", cell: (r) => formatCurrency(r.maintenance) },
          { header: "Expenses", cell: (r) => formatCurrency(r.expenses) },
          { header: "Total", cell: (r) => <b>{formatCurrency(r.total)}</b> },
        ]}
      />
      {data && (
        <p className="text-xs text-muted-foreground font-medium mt-2">
          {data.note}
        </p>
      )}
    </div>
  );
}

export default function FuelExpensesPage() {
  const { can } = useAuth();
  const canWrite = can("expenses:write");
  const canApprove = can("expenses:approve");
  const [tab, setTab] = useState("fuel");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(null);
  const [review, setReview] = useState(null);
  const fuel = useQuery({
    queryKey: ["fuel", page],
    queryFn: () => get("/fuel", { page, limit: 15 }),
    enabled: tab === "fuel",
  });
  const exp = useQuery({
    queryKey: ["expenses", page, status],
    queryFn: () => get("/expenses", { page, limit: 15, status }),
    enabled: tab === "expenses",
  });
  const disabled = [fuel.error, exp.error].some((e) => e?.status === 403);
  return (
    <AppLayout title="Fuel & Expenses">
      <PageHeader
        title="Fuel & expenses"
        subtitle="Fuel fills, operating expenses and cost roll-ups"
        actions={
          canWrite &&
          !disabled &&
          tab !== "costs" && (
            <PrimaryButton onClick={() => setForm(tab)}>
              <Plus className="w-4 h-4" />{" "}
              {tab === "fuel" ? "Record fuel" : "Submit expense"}
            </PrimaryButton>
          )
        }
      />
      <div className="flex gap-2 mb-4">
        {[
          ["fuel", "Fuel"],
          ["expenses", "Expenses"],
          ["costs", "Costs"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
            className={`border-2 border-black px-4 py-1.5 text-sm font-bold ${tab === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {disabled ? (
        <EmptyState
          icon={Fuel}
          title="Module not enabled"
          message="Fuel and expense tracking is switched off for your organization."
        />
      ) : tab === "costs" ? (
        <Costs />
      ) : tab === "fuel" ? (
        <DataTable
          loading={fuel.isLoading}
          rows={fuel.data?.data ?? []}
          meta={fuel.data?.meta}
          onPage={setPage}
          empty={
            <EmptyState
              icon={Fuel}
              title="No fuel records"
              message="Record fills to track fuel cost and measure mileage."
              action={
                canWrite ? (
                  <PrimaryButton onClick={() => setForm("fuel")}>
                    Record fuel
                  </PrimaryButton>
                ) : undefined
              }
            />
          }
          columns={[
            {
              header: "When",
              cell: (l) => new Date(l.filledAt).toLocaleString("en-IN"),
            },
            { header: "Vehicle", cell: (l) => l.vehicle?.registrationNumber },
            {
              header: "Qty",
              cell: (l) => `${l.quantity} @ ${formatCurrency(l.pricePerUnit)}`,
            },
            {
              header: "Total",
              cell: (l) => <b>{formatCurrency(l.totalAmount)}</b>,
            },
            {
              header: "Odometer",
              cell: (l) => `${l.odometer.toLocaleString("en-IN")} km`,
            },
            { header: "Full tank", cell: (l) => (l.fullTank ? "Yes" : "No") },
            { header: "By", cell: (l) => l.recordedBy?.name ?? "—" },
          ]}
        />
      ) : (
        <>
          <div className="mb-3">
            <FilterSelect
              value={status}
              onChange={(s) => {
                setStatus(s);
                setPage(1);
              }}
              all="All Status"
              options={Object.entries(ES).map(([value, m]) => ({
                value,
                label: m.label,
              }))}
            />
          </div>
          <DataTable
            loading={exp.isLoading}
            rows={exp.data?.data ?? []}
            meta={exp.data?.meta}
            onPage={setPage}
            empty={
              <EmptyState
                icon={Receipt}
                title="No expenses"
                message="Submit tolls, parking, repairs and other costs for approval."
                action={
                  canWrite ? (
                    <PrimaryButton onClick={() => setForm("expenses")}>
                      Submit expense
                    </PrimaryButton>
                  ) : undefined
                }
              />
            }
            columns={[
              { header: "Date", cell: (e) => formatDateOrDash(e.date) },
              {
                header: "Category",
                cell: (e) => (
                  <span className="capitalize">
                    {e.category.replace("_", " ")}
                  </span>
                ),
              },
              {
                header: "Vehicle",
                cell: (e) => e.vehicle?.registrationNumber ?? "—",
              },
              { header: "Vendor", cell: (e) => e.vendor ?? "—" },
              {
                header: "Amount",
                cell: (e) => <b>{formatCurrency(e.amount)}</b>,
              },
              { header: "By", cell: (e) => e.submittedBy?.name ?? "—" },
              {
                header: "Status",
                cell: (e) => (
                  <div>
                    <StatusBadge meta={ES[e.status]} />
                    {e.reviewNote && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {e.reviewNote}
                      </p>
                    )}
                  </div>
                ),
              },
              ...(canApprove
                ? [
                    {
                      header: "Review",
                      cell: (e) =>
                        e.status === "pending" ? (
                          <div className="flex gap-1">
                            <button
                              aria-label="Approve"
                              onClick={() =>
                                setReview({ e, decision: "approved" })
                              }
                              className="border-2 border-black p-1.5"
                            >
                              <Check className="w-3.5 h-3.5 text-green-700" />
                            </button>
                            <button
                              aria-label="Reject"
                              onClick={() =>
                                setReview({ e, decision: "rejected" })
                              }
                              className="border-2 border-black p-1.5"
                            >
                              <X className="w-3.5 h-3.5 text-red-600" />
                            </button>
                          </div>
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
      {form === "fuel" && <FuelForm onClose={() => setForm(null)} />}
      {form === "expenses" && <ExpenseForm onClose={() => setForm(null)} />}
      {review && (
        <ReviewDialog
          expense={review.e}
          decision={review.decision}
          onClose={() => setReview(null)}
        />
      )}
    </AppLayout>
  );
}
