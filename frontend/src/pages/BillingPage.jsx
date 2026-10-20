import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  FileText,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  Wallet,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common/PageHeader";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { FilterSelect } from "@/components/common/SearchInput";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, patch, post, put, del } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatDate } from "@/lib/utils";

// The API stores money as integer minor units (paise). Everything user-facing converts here.
const toMinor = (v) => Math.round(Number(v) * 100);
const useMoney = () => {
  const { data } = useQuery({
    queryKey: ["billing-config"],
    queryFn: async () => (await get("/billing/config")).data,
  });
  const cur = data?.currency ?? "INR";
  const fmt = (m) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
    }).format((m ?? 0) / 100);
  return { fmt, cur, config: data };
};
const STATUS = {
  issued: ["Issued", "nb-tag-blue"],
  partially_paid: ["Part paid", "nb-tag-yellow"],
  paid: ["Paid", "nb-tag-green"],
  void: ["Void", "nb-tag-white"],
};
const Err = ({ children }) => (
  <div
    role="alert"
    className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
  >
    {children}
  </div>
);
const ymd = (d) => new Date(d).toLocaleDateString("en-CA");

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the payment window"));
    document.head.appendChild(s);
  });
}

function Receipt({ paymentId, onClose }) {
  const { fmt } = useMoney();
  const { data } = useQuery({
    queryKey: ["receipt", paymentId],
    queryFn: async () =>
      (await get(`/billing/payments/${paymentId}/receipt`)).data,
  });
  return (
    <Modal title="Receipt" onClose={onClose}>
      {!data ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <div className="space-y-3 text-sm" id="receipt-print">
          <div className="text-center border-b-2 border-black pb-2">
            <p className="font-bold text-lg">{data.organization}</p>
            <p className="font-semibold">
              Payment receipt {data.receiptNumber}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Received from</dt>
            <dd className="font-semibold">
              {data.billTo?.name ?? data.passenger?.name}
            </dd>
            <dt className="text-muted-foreground">Passenger</dt>
            <dd className="font-semibold">{data.passenger?.name}</dd>
            <dt className="text-muted-foreground">Invoice</dt>
            <dd className="font-semibold">
              {data.invoice.number} · {data.invoice.period}
            </dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-semibold">
              {formatDate(data.payment.receivedAt)}
            </dd>
            <dt className="text-muted-foreground">Method</dt>
            <dd className="font-semibold capitalize">
              {data.payment.method}
              {data.payment.reference ? ` · ${data.payment.reference}` : ""}
            </dd>
            <dt className="text-muted-foreground">Amount received</dt>
            <dd className="font-bold text-base">{fmt(data.payment.amount)}</dd>
            {data.payment.refundedAmount > 0 && (
              <>
                <dt className="text-muted-foreground">Refunded</dt>
                <dd className="font-semibold">
                  {fmt(data.payment.refundedAmount)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Invoice balance</dt>
            <dd className="font-semibold">{fmt(data.invoice.balance)}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Recorded by {data.payment.recordedBy?.name ?? "system"}
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4 print:hidden">
        <SecondaryButton onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print
        </SecondaryButton>
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      </div>
    </Modal>
  );
}

function InvoiceDetail({ id, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const { fmt, config } = useMoney();
  const [mode, setMode] = useState(null); // pay | adjust | void | refund
  const [refundOf, setRefundOf] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [f, setF] = useState({
    amount: "",
    method: "cash",
    reference: "",
    description: "",
    reason: "",
    kind: "discount",
  });
  const [error, setError] = useState("");
  const { data: inv } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => (await get(`/billing/invoices/${id}`)).data,
  });
  const refresh = () =>
    ["invoice", "invoices", "billing-payments", "outstanding"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  const ok = (msg) => {
    refresh();
    setMode(null);
    setRefundOf(null);
    setError("");
    setF({
      amount: "",
      method: "cash",
      reference: "",
      description: "",
      reason: "",
      kind: "discount",
    });
    toast({ title: msg, variant: "success" });
  };
  const run = useMutation({
    mutationFn: async () => {
      if (mode === "pay")
        return post(`/billing/invoices/${id}/payments`, {
          amount: toMinor(f.amount),
          method: f.method,
          reference: f.reference || undefined,
          clientRef: crypto.randomUUID?.(),
        });
      if (mode === "adjust") {
        const amt = toMinor(f.amount);
        return post(`/billing/invoices/${id}/adjust`, {
          description: f.description,
          kind: f.kind,
          amount: f.kind === "discount" ? -Math.abs(amt) : Math.abs(amt),
          reason: f.reason,
        });
      }
      if (mode === "void")
        return post(`/billing/invoices/${id}/void`, { reason: f.reason });
      if (mode === "refund")
        return post(`/billing/payments/${refundOf._id}/refund`, {
          amount: toMinor(f.amount),
          reason: f.reason,
        });
    },
    onSuccess: () => ok("Saved"),
    onError: (e) => setError(errMsg(e)),
  });
  const online = useMutation({
    mutationFn: async () => {
      const o = (await post(`/billing/invoices/${id}/razorpay-order`)).data;
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: o.keyId,
          amount: o.amount,
          currency: o.currency,
          order_id: o.orderId,
          name: "Transport fee",
          description: o.invoiceNumber,
          // Checkout's callback is only a hint: the server verifies it before anything is recorded.
          handler: async (resp) => {
            try {
              const r = await post("/billing/razorpay/verify", {
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
              });
              resolve(r);
            } catch (e) {
              reject(e);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment window closed")),
          },
        });
        rz.open();
      });
    },
    onSuccess: () => ok("Payment received"),
    onError: (e) => setError(errMsg(e)),
  });
  if (!inv)
    return (
      <Modal title="Invoice" onClose={onClose}>
        <p className="text-sm">Loading…</p>
      </Modal>
    );
  const [stLabel, stCls] = STATUS[inv.status];
  const open = inv.status !== "void" && inv.balance > 0;
  return (
    <Modal
      title={`${inv.number} · ${inv.passenger?.name}`}
      onClose={onClose}
      wide
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`nb-badge uppercase ${stCls}`}>{stLabel}</span>
          <span className="font-semibold">
            Period {inv.period} · due {formatDate(inv.dueDate)}
          </span>
        </div>
        <div className="border-2 border-black bg-white">
          <table className="w-full">
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l._id} className="border-b border-black/10">
                  <td className="px-3 py-2">
                    {l.description}
                    {l.reason && (
                      <span className="block text-xs text-muted-foreground">
                        {l.reason}
                        {l.addedBy?.name ? ` · ${l.addedBy.name}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmt(l.amount)}
                  </td>
                </tr>
              ))}
              <tr className="font-bold bg-[#024BAB]/5">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmt(inv.total)}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2">Paid (after refunds)</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmt(inv.paid)}
                </td>
              </tr>
              <tr className="font-bold">
                <td className="px-3 py-2">Balance</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmt(inv.balance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {inv.payments.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-1">
              Payments
            </p>
            <ul className="border-2 border-black bg-white divide-y divide-black/10">
              {inv.payments.map((p) => (
                <li
                  key={p._id}
                  className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    <b>{p.number}</b> · {fmt(p.amount)} ·{" "}
                    <span className="capitalize">{p.method}</span>
                    {p.reference ? ` · ${p.reference}` : ""} ·{" "}
                    {formatDate(p.receivedAt)}
                    {p.refundedAmount > 0 && (
                      <span className="text-red-700 font-semibold">
                        {" "}
                        · refunded {fmt(p.refundedAmount)}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    <button
                      aria-label="Receipt"
                      onClick={() => setReceipt(p._id)}
                      className="border-2 border-black p-1.5"
                    >
                      <ReceiptIcon className="w-3.5 h-3.5" />
                    </button>
                    {can("billing:refund") &&
                      p.amount - p.refundedAmount > 0 && (
                        <button
                          onClick={() => {
                            setRefundOf(p);
                            setMode("refund");
                          }}
                          className="border-2 border-black px-2 py-1 text-xs font-bold"
                        >
                          Refund
                        </button>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {inv.refunds.length > 0 && (
          <p className="text-xs text-muted-foreground font-medium">
            Refunds:{" "}
            {inv.refunds
              .map((r) => `${fmt(r.amount)} (${r.reason})`)
              .join("; ")}
          </p>
        )}
        {error && <Err>{error}</Err>}
        {mode && (
          <div className="border-2 border-black p-3 space-y-3 bg-[#024BAB]/5">
            <p className="font-bold capitalize">
              {mode === "pay"
                ? "Record a payment"
                : mode === "adjust"
                  ? "Add adjustment"
                  : mode === "void"
                    ? "Void invoice"
                    : `Refund ${refundOf?.number}`}
            </p>
            {["pay", "adjust", "refund"].includes(mode) && (
              <Field
                label={
                  mode === "refund"
                    ? `Amount (max ${fmt(refundOf.amount - refundOf.refundedAmount)})`
                    : "Amount"
                }
              >
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={inputCls}
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                  placeholder={mode === "pay" ? String(inv.balance / 100) : ""}
                />
              </Field>
            )}
            {mode === "pay" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Method">
                  <select
                    className={inputCls}
                    value={f.method}
                    onChange={(e) => setF({ ...f, method: e.target.value })}
                  >
                    {["cash", "upi", "card", "bank", "cheque"].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={
                    f.method === "cash"
                      ? "Reference (optional)"
                      : "Reference no."
                  }
                >
                  <input
                    className={inputCls}
                    value={f.reference}
                    onChange={(e) => setF({ ...f, reference: e.target.value })}
                  />
                </Field>
              </div>
            )}
            {mode === "adjust" && (
              <>
                <Field label="Type">
                  <select
                    className={inputCls}
                    value={f.kind}
                    onChange={(e) => setF({ ...f, kind: e.target.value })}
                  >
                    <option value="discount">Discount / waiver</option>
                    <option value="surcharge">Surcharge</option>
                    <option value="adjustment">Correction (+/-)</option>
                  </select>
                </Field>
                <Field label="Description">
                  <input
                    className={inputCls}
                    value={f.description}
                    onChange={(e) =>
                      setF({ ...f, description: e.target.value })
                    }
                  />
                </Field>
              </>
            )}
            {["adjust", "void", "refund"].includes(mode) && (
              <Field label="Reason (recorded in the audit trail)" required>
                <input
                  className={inputCls}
                  value={f.reason}
                  onChange={(e) => setF({ ...f, reason: e.target.value })}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setMode(null);
                  setError("");
                }}
                className="border-2 border-black bg-white px-3 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <PrimaryButton
                disabled={run.isPending}
                onClick={() => {
                  setError("");
                  run.mutate();
                }}
              >
                Confirm
              </PrimaryButton>
            </div>
          </div>
        )}
        {!mode && inv.status !== "void" && (
          <div className="flex flex-wrap gap-2">
            {can("billing:collect") && open && (
              <PrimaryButton onClick={() => setMode("pay")}>
                <Wallet className="w-4 h-4" /> Record payment
              </PrimaryButton>
            )}
            {can("billing:collect") && open && config?.razorpay.enabled && (
              <SecondaryButton
                disabled={online.isPending}
                onClick={() => {
                  setError("");
                  online.mutate();
                }}
              >
                <CreditCard className="w-4 h-4" />{" "}
                {online.isPending ? "Waiting…" : "Pay online"}
              </SecondaryButton>
            )}
            {can("billing:write") && (
              <SecondaryButton onClick={() => setMode("adjust")}>
                Adjust
              </SecondaryButton>
            )}
            {can("billing:write") && inv.paid === 0 && (
              <button
                onClick={() => setMode("void")}
                className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-red-600"
              >
                Void
              </button>
            )}
          </div>
        )}
        {inv.status === "void" && (
          <p className="font-semibold text-muted-foreground">
            Voided: {inv.voidReason}
          </p>
        )}
      </div>
      {receipt && (
        <Receipt paymentId={receipt} onClose={() => setReceipt(null)} />
      )}
    </Modal>
  );
}

function GenerateDialog({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { fmt } = useMoney();
  const routes = useQuery({
    queryKey: ["routes", "pick"],
    queryFn: async () => (await get("/routes", { limit: 100 })).data,
  });
  const [f, setF] = useState({
    period: new Date().toISOString().slice(0, 7),
    dueDate: ymd(Date.now() + 10 * 86400000),
    route: "",
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const body = (preview) => ({
    period: f.period,
    dueDate: new Date(f.dueDate).toISOString(),
    route: f.route || undefined,
    preview,
  });
  const m = useMutation({
    mutationFn: (preview) => post("/billing/invoices/generate", body(preview)),
    onSuccess: (r, preview) => {
      setResult({ ...r.data, preview });
      setError("");
      if (!preview) {
        qc.invalidateQueries({ queryKey: ["invoices"] });
        toast({
          title: `${r.data.created.length} invoices created`,
          variant: "success",
        });
      }
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Generate invoices" onClose={onClose} wide>
      <div className="space-y-3">
        {error && <Err>{error}</Err>}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Period" required>
            <input
              className={inputCls}
              value={f.period}
              onChange={(e) => {
                setF({ ...f, period: e.target.value });
                setResult(null);
              }}
            />
          </Field>
          <Field label="Due date" required>
            <input
              type="date"
              className={inputCls}
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            />
          </Field>
          <Field label="Route (optional)">
            <select
              className={inputCls}
              value={f.route}
              onChange={(e) => {
                setF({ ...f, route: e.target.value });
                setResult(null);
              }}
            >
              <option value="">All routes</option>
              {routes.data?.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground font-medium">
          Uses each passenger's route, stop plan and their discounts. A
          passenger already invoiced for the period is skipped, so running this
          twice is safe.
        </p>
        {result && (
          <div className="border-2 border-black p-3 text-sm space-y-1">
            <p className="font-bold">
              {result.preview ? "Preview — nothing created yet" : "Done"}:{" "}
              {result.created.length} invoice(s), {fmt(result.totalAmount)}
            </p>
            {result.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer font-semibold">
                  {result.skipped.length} skipped
                </summary>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {s.passenger}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Close
          </button>
          <SecondaryButton
            disabled={m.isPending}
            onClick={() => m.mutate(true)}
          >
            Preview
          </SecondaryButton>
          <PrimaryButton
            disabled={m.isPending || !f.period}
            onClick={() => m.mutate(false)}
          >
            Generate
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function Invoices({ onOpen }) {
  const { can } = useAuth();
  const { fmt } = useMoney();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("unpaid");
  const [gen, setGen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["invoices", page, status],
    queryFn: () => get("/billing/invoices", { page, limit: 15, status }),
  });
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterSelect
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          all="All"
          options={[
            { value: "unpaid", label: "Unpaid" },
            { value: "overdue", label: "Overdue" },
            { value: "paid", label: "Paid" },
            { value: "void", label: "Void" },
          ]}
        />
        {can("billing:write") && (
          <PrimaryButton onClick={() => setGen(true)}>
            <Plus className="w-4 h-4" /> Generate invoices
          </PrimaryButton>
        )}
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data ?? []}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={FileText}
            title="No invoices"
            message="Create fee plans, assign passengers to routes, then generate invoices for a period."
          />
        }
        columns={[
          {
            header: "Invoice",
            cell: (i) => (
              <button
                onClick={() => onOpen(i._id)}
                className="font-bold underline"
              >
                {i.number}
              </button>
            ),
          },
          { header: "Passenger", cell: (i) => i.passenger?.name },
          { header: "Period", cell: (i) => i.period },
          { header: "Due", cell: (i) => formatDate(i.dueDate) },
          { header: "Total", cell: (i) => fmt(i.total) },
          { header: "Balance", cell: (i) => <b>{fmt(i.balance)}</b> },
          {
            header: "Status",
            cell: (i) => (
              <span className={`nb-badge uppercase ${STATUS[i.status][1]}`}>
                {STATUS[i.status][0]}
              </span>
            ),
          },
        ]}
      />
      {gen && <GenerateDialog onClose={() => setGen(false)} />}
    </div>
  );
}

function Plans() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { fmt } = useMoney();
  const { can } = useAuth();
  const routes = useQuery({
    queryKey: ["routes", "pick"],
    queryFn: async () => (await get("/routes", { limit: 100 })).data,
  });
  const plans = useQuery({
    queryKey: ["fee-plans"],
    queryFn: async () => (await get("/billing/fee-plans")).data,
  });
  const charges = useQuery({
    queryKey: ["charges"],
    queryFn: async () => (await get("/billing/charges")).data,
  });
  const passengers = useQuery({
    queryKey: ["passengers", "pick"],
    queryFn: async () => (await get("/passengers", { limit: 100 })).data,
  });
  const [form, setForm] = useState(null);
  const [cform, setCform] = useState(null);
  const [error, setError] = useState("");
  const route = routes.data?.find((r) => r._id === form?.route);
  const savePlan = useMutation({
    mutationFn: () =>
      post("/billing/fee-plans", {
        name: form.name,
        kind: form.kind,
        route: form.route || undefined,
        stopName: form.kind === "stop" ? form.stopName : undefined,
        amount: toMinor(form.amount),
        frequency: form.frequency,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-plans"] });
      setForm(null);
      setError("");
      toast({ title: "Fee plan saved", variant: "success" });
    },
    onError: (e) => setError(errMsg(e)),
  });
  const archive = useMutation({
    mutationFn: (id) => del(`/billing/fee-plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fee-plans"] }),
  });
  const saveCharge = useMutation({
    mutationFn: () =>
      post("/billing/charges", {
        passenger: cform.passenger,
        label: cform.label,
        type: cform.type,
        mode: cform.mode,
        value:
          cform.mode === "fixed" ? toMinor(cform.value) : Number(cform.value),
        fromPeriod: cform.fromPeriod || undefined,
        toPeriod: cform.toPeriod || undefined,
        reason: cform.reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["charges"] });
      setCform(null);
      setError("");
    },
    onError: (e) => setError(errMsg(e)),
  });
  const toggle = useMutation({
    mutationFn: (c) =>
      patch(`/billing/charges/${c._id}`, { active: !c.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["charges"] }),
  });
  const write = can("billing:write");
  return (
    <div className="space-y-6">
      <section>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold">Fee plans</h3>
          {write && (
            <PrimaryButton
              onClick={() =>
                setForm({
                  name: "",
                  kind: "route",
                  route: "",
                  stopName: "",
                  amount: "",
                  frequency: "monthly",
                })
              }
            >
              <Plus className="w-4 h-4" /> Add plan
            </PrimaryButton>
          )}
        </div>
        <DataTable
          loading={plans.isLoading}
          rows={plans.data ?? []}
          onPage={() => {}}
          empty={
            <EmptyState
              icon={FileText}
              title="No fee plans"
              message="Add a route-based, stop-based or flat fee."
            />
          }
          columns={[
            { header: "Plan", cell: (p) => <b>{p.name}</b> },
            {
              header: "Applies to",
              cell: (p) =>
                p.kind === "flat"
                  ? "Everyone"
                  : p.kind === "route"
                    ? `Route ${p.route?.code}`
                    : `${p.route?.code} · stop ${p.stopName}`,
            },
            { header: "Amount", cell: (p) => fmt(p.amount) },
            { header: "Frequency", cell: (p) => p.frequency.replace("_", " ") },
            ...(write
              ? [
                  {
                    header: "",
                    cell: (p) => (
                      <button
                        onClick={() =>
                          window.confirm(
                            `Archive ${p.name}? Existing invoices are unaffected.`,
                          ) && archive.mutate(p._id)
                        }
                        className="border-2 border-black px-2 py-1 text-xs font-bold"
                      >
                        Archive
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>
      <section>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold">Passenger discounts & surcharges</h3>
          {write && (
            <PrimaryButton
              onClick={() =>
                setCform({
                  passenger: "",
                  label: "",
                  type: "discount",
                  mode: "percent",
                  value: "",
                  fromPeriod: "",
                  toPeriod: "",
                  reason: "",
                })
              }
            >
              <Plus className="w-4 h-4" /> Add
            </PrimaryButton>
          )}
        </div>
        <DataTable
          loading={charges.isLoading}
          rows={charges.data ?? []}
          onPage={() => {}}
          empty={
            <EmptyState
              icon={FileText}
              title="None set"
              message="Discounts and surcharges apply automatically when invoices are generated."
            />
          }
          columns={[
            { header: "Passenger", cell: (c) => c.passenger?.name },
            { header: "Label", cell: (c) => c.label },
            {
              header: "Type",
              cell: (c) => <span className="capitalize">{c.type}</span>,
            },
            {
              header: "Value",
              cell: (c) =>
                c.mode === "percent" ? `${c.value}%` : fmt(c.value),
            },
            {
              header: "Period",
              cell: (c) =>
                c.fromPeriod || c.toPeriod
                  ? `${c.fromPeriod ?? "…"} – ${c.toPeriod ?? "…"}`
                  : "Always",
            },
            {
              header: "Status",
              cell: (c) => (
                <span
                  className={`nb-badge uppercase ${c.active ? "nb-tag-green" : "nb-tag-white"}`}
                >
                  {c.active ? "Active" : "Off"}
                </span>
              ),
            },
            ...(write
              ? [
                  {
                    header: "",
                    cell: (c) => (
                      <button
                        onClick={() => toggle.mutate(c)}
                        className="border-2 border-black px-2 py-1 text-xs font-bold"
                      >
                        {c.active ? "Turn off" : "Turn on"}
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>
      {form && (
        <Modal title="New fee plan" onClose={() => setForm(null)}>
          <div className="space-y-3">
            {error && <Err>{error}</Err>}
            <Field label="Name" required>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Applies to">
              <select
                className={inputCls}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                <option value="route">A route</option>
                <option value="stop">A pickup stop</option>
                <option value="flat">Everyone (flat)</option>
              </select>
            </Field>
            {form.kind !== "flat" && (
              <Field label="Route" required>
                <select
                  className={inputCls}
                  value={form.route}
                  onChange={(e) =>
                    setForm({ ...form, route: e.target.value, stopName: "" })
                  }
                >
                  <option value="">Select…</option>
                  {routes.data?.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.kind === "stop" && (
              <Field label="Stop" required>
                <select
                  className={inputCls}
                  value={form.stopName}
                  onChange={(e) =>
                    setForm({ ...form, stopName: e.target.value })
                  }
                >
                  <option value="">Select…</option>
                  {route?.stops.map((s) => (
                    <option key={s.sequence} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" required>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field label="Frequency">
                <select
                  className={inputCls}
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value })
                  }
                >
                  <option value="monthly">Monthly</option>
                  <option value="term">Term</option>
                  <option value="one_time">One time (manual)</option>
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground font-medium">
              A stop plan replaces the route plan for passengers boarding at
              that stop.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setForm(null)}
                className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <PrimaryButton
                disabled={
                  savePlan.isPending || !form.name || form.amount === ""
                }
                onClick={() => savePlan.mutate()}
              >
                Save plan
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
      {cform && (
        <Modal title="Discount / surcharge" onClose={() => setCform(null)}>
          <div className="space-y-3">
            {error && <Err>{error}</Err>}
            <Field label="Passenger" required>
              <select
                className={inputCls}
                value={cform.passenger}
                onChange={(e) =>
                  setCform({ ...cform, passenger: e.target.value })
                }
              >
                <option value="">Select…</option>
                {passengers.data?.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Label" required>
              <input
                className={inputCls}
                placeholder="Sibling discount"
                value={cform.label}
                onChange={(e) => setCform({ ...cform, label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Type">
                <select
                  className={inputCls}
                  value={cform.type}
                  onChange={(e) => setCform({ ...cform, type: e.target.value })}
                >
                  <option value="discount">Discount</option>
                  <option value="surcharge">Surcharge</option>
                </select>
              </Field>
              <Field label="How">
                <select
                  className={inputCls}
                  value={cform.mode}
                  onChange={(e) => setCform({ ...cform, mode: e.target.value })}
                >
                  <option value="percent">% of fees</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </Field>
              <Field
                label={cform.mode === "percent" ? "Percent" : "Amount"}
                required
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  value={cform.value}
                  onChange={(e) =>
                    setCform({ ...cform, value: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From period">
                <input
                  className={inputCls}
                  placeholder="2030-04"
                  value={cform.fromPeriod}
                  onChange={(e) =>
                    setCform({ ...cform, fromPeriod: e.target.value })
                  }
                />
              </Field>
              <Field label="To period">
                <input
                  className={inputCls}
                  placeholder="2030-12"
                  value={cform.toPeriod}
                  onChange={(e) =>
                    setCform({ ...cform, toPeriod: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCform(null)}
                className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <PrimaryButton
                disabled={
                  saveCharge.isPending ||
                  !cform.passenger ||
                  !cform.label ||
                  cform.value === ""
                }
                onClick={() => saveCharge.mutate()}
              >
                Save
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Payments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const { fmt } = useMoney();
  const [page, setPage] = useState(1);
  const [reconciled, setReconciled] = useState("");
  const [receipt, setReceipt] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["billing-payments", page, reconciled],
    queryFn: () =>
      get("/billing/payments", {
        page,
        limit: 15,
        reconciled: reconciled || undefined,
      }),
  });
  const rec = useMutation({
    mutationFn: (p) => post(`/billing/payments/${p._id}/reconcile`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing-payments"] }),
    onError: (e) =>
      toast({
        title: "Not reconciled",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  return (
    <div>
      <div className="mb-4">
        <FilterSelect
          value={reconciled}
          onChange={(v) => {
            setReconciled(v);
            setPage(1);
          }}
          all="All payments"
          options={[
            { value: "false", label: "Not reconciled" },
            { value: "true", label: "Reconciled" },
          ]}
        />
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data ?? []}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={Wallet}
            title="No payments"
            message="Payments recorded against invoices appear here."
          />
        }
        columns={[
          {
            header: "Receipt",
            cell: (p) => (
              <button
                onClick={() => setReceipt(p._id)}
                className="font-bold underline"
              >
                {p.number}
              </button>
            ),
          },
          { header: "Date", cell: (p) => formatDate(p.receivedAt) },
          { header: "Passenger", cell: (p) => p.passenger?.name },
          { header: "Invoice", cell: (p) => p.invoice?.number },
          {
            header: "Method",
            cell: (p) => (
              <span className="capitalize">
                {p.method}
                {p.reference ? ` · ${p.reference}` : ""}
              </span>
            ),
          },
          { header: "Amount", cell: (p) => <b>{fmt(p.amount)}</b> },
          {
            header: "Refunded",
            cell: (p) => (p.refundedAmount ? fmt(p.refundedAmount) : "—"),
          },
          {
            header: "Reconciled",
            cell: (p) =>
              p.reconciled?.at ? (
                <span className="nb-badge nb-tag-green">Yes</span>
              ) : can("billing:collect") ? (
                <button
                  onClick={() => rec.mutate(p)}
                  className="border-2 border-black px-2 py-1 text-xs font-bold"
                >
                  Mark reconciled
                </button>
              ) : (
                "No"
              ),
          },
        ]}
      />
      {receipt && (
        <Receipt paymentId={receipt} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

function Outstanding({ onOpen }) {
  const { fmt } = useMoney();
  const { data, isLoading } = useQuery({
    queryKey: ["outstanding"],
    queryFn: async () => (await get("/billing/outstanding")).data,
  });
  const t = data?.totals;
  return (
    <div>
      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard
            label="Total outstanding"
            value={fmt(t.balance)}
            icon={Wallet}
            color="#EF4444"
          />
          <StatCard
            label="Not yet due"
            value={fmt(t.current)}
            icon={FileText}
          />
          <StatCard
            label="1–30 days late"
            value={fmt(t.d1_30)}
            icon={FileText}
            color="#D97706"
          />
          <StatCard
            label="Over 30 days late"
            value={fmt(t.d31_60 + t.d61_plus)}
            icon={FileText}
            color="#EF4444"
          />
        </div>
      )}
      <DataTable
        loading={isLoading}
        rows={(data?.rows ?? []).map((r) => ({ ...r, _id: r.passenger._id }))}
        onPage={() => {}}
        empty={
          <EmptyState
            icon={Wallet}
            title="Nothing outstanding"
            message="All issued invoices are paid."
          />
        }
        columns={[
          { header: "Passenger", cell: (r) => <b>{r.passenger.name}</b> },
          { header: "Invoices", cell: (r) => r.invoices },
          { header: "Not due", cell: (r) => fmt(r.current) },
          { header: "1–30", cell: (r) => fmt(r.d1_30) },
          { header: "31–60", cell: (r) => fmt(r.d31_60) },
          { header: "60+", cell: (r) => fmt(r.d61_plus) },
          { header: "Balance", cell: (r) => <b>{fmt(r.balance)}</b> },
        ]}
      />
    </div>
  );
}

export default function BillingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState("invoices");
  const [open, setOpen] = useState(null);
  const cfg = useQuery({
    queryKey: ["billing-config"],
    queryFn: async () => (await get("/billing/config")).data,
    retry: false,
  });
  if (cfg.error?.status === 403)
    return (
      <AppLayout title="Fees">
        <PageHeader title="Transport fees" />
        <EmptyState
          icon={CreditCard}
          title="Fees & billing is switched off"
          message="An owner or admin can turn it on under Settings → Organization → Modules."
        />
      </AppLayout>
    );
  return (
    <AppLayout title="Fees">
      <PageHeader
        title="Transport fees & billing"
        subtitle="Fee plans, invoices, payments and dues"
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          ["invoices", "Invoices"],
          ["outstanding", "Outstanding"],
          ["payments", "Payments"],
          ...(can("billing:write") || can("billing:read")
            ? [["plans", "Fee plans & discounts"]]
            : []),
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-2 border-black px-4 py-1.5 text-sm font-bold ${tab === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "invoices" ? (
        <Invoices onOpen={setOpen} />
      ) : tab === "outstanding" ? (
        <Outstanding onOpen={setOpen} />
      ) : tab === "payments" ? (
        <Payments />
      ) : (
        <Plans />
      )}
      {open && <InvoiceDetail id={open} onClose={() => setOpen(null)} />}
    </AppLayout>
  );
}
