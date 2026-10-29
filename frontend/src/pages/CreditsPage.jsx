import { useCallback, useEffect, useState } from "react";
import { Coins, Gift, MessageCircle, Plus, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { fmtCredits, useCredits } from "@/contexts/CreditsContext";
import { useToast } from "@/hooks/use-toast";
import { get, post } from "@/services/api";
import { getErrorMessage } from "@/lib/utils";

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

const FILTERS = [
  { key: "", label: "All" },
  { key: "debit", label: "Charged" },
  { key: "skipped", label: "Not sent" },
  { key: "refund", label: "Refunds" },
  { key: "topup", label: "Top-ups" },
  { key: "bonus", label: "Bonus" },
];

const CHANNEL_LABEL = { whatsapp: "WhatsApp message", sms: "SMS" };

const REASON = {
  low_balance: "Not sent: no credits",
  daily_cap: "Not sent: daily limit reached",
  send_failed: "Refunded: could not send",
  delivery_failed: "Refunded: not delivered",
};

const inr = (n) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const cx = (...a) => a.filter(Boolean).join(" ");

export default function CreditsPage() {
  const { can } = useAuth();
  const { credits, refresh } = useCredits();
  const { toast } = useToast();
  const [packs, setPacks] = useState([]);
  const [gstPct, setGstPct] = useState(18);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [topups, setTopups] = useState([]);
  const [usage, setUsage] = useState(null);
  const [paying, setPaying] = useState(null);
  const canManage = can("settings:write");

  const loadLedger = useCallback(async (p, f) => {
    try {
      const res = await get("/credits/ledger", { page: p, type: f });
      setRows((prev) => (p === 1 ? res.data : [...prev, ...res.data]));
      setTotal(res.total);
      setPage(p);
    } catch {
      // table just stays as it was
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    get("/credits/packs")
      .then((r) => {
        setPacks(r.data.packs);
        setGstPct(r.data.gstPct);
      })
      .catch(() => {});
    get("/credits/topups").then((r) => setTopups(r.data)).catch(() => {});
    get("/credits/estimate").then((r) => setUsage(r.data)).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    if (canManage) loadLedger(1, filter);
  }, [canManage, filter, loadLedger]);

  const buy = async (pack) => {
    setPaying(pack.id);
    try {
      const o = (await post("/credits/topup", { packId: pack.id })).data;
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: o.keyId,
          amount: Math.round(o.amount * 100),
          currency: o.currency,
          order_id: o.orderId,
          name: "Nest Transport",
          description: `${fmtCredits(pack.credits)} WhatsApp / SMS credits`,
          // Checkout's callback is only a hint: the server verifies the signature and amount before crediting.
          handler: async (resp) => {
            try {
              await post("/credits/topup/verify", resp);
              toast({
                title: "Credits added",
                description: `${fmtCredits(pack.credits)} credits are in your wallet.`,
                variant: "success",
              });
              await refresh();
              get("/credits/topups").then((r) => setTopups(r.data)).catch(() => {});
              loadLedger(1, filter);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          modal: { ondismiss: () => resolve() },
        });
        rz.on("payment.failed", (r) =>
          reject(new Error(r?.error?.description || "Payment failed")),
        );
        rz.open();
      });
    } catch (e) {
      toast({
        title: "Could not add credits",
        description: getErrorMessage(e),
        variant: "destructive",
      });
    }
    setPaying(null);
  };

  if (!canManage) {
    return (
      <AppLayout title="WhatsApp & SMS Credits">
        <p className="text-sm font-medium text-gray-600">
          Only the owner and admins can manage credits.
        </p>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="WhatsApp & SMS Credits">
      <div className="max-w-5xl space-y-6">
        {credits && !credits.metered ? (
          <div className="border-2 border-black bg-white p-6">
            <p className="font-medium text-black">
              Credits are not enabled for your organization
            </p>
            <p className="text-sm text-gray-600 mt-1">
              WhatsApp and SMS are included in your plan, so there is nothing to
              top up.
            </p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              <div
                className={cx(
                  "sm:col-span-2 border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
                  credits?.zero ? "bg-red-50" : "bg-white",
                )}
              >
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                  <Coins className="w-4 h-4 text-[#024BAB]" /> Available credits
                </div>
                <p
                  className={cx(
                    "text-5xl font-medium mt-2",
                    credits?.zero ? "text-red-600" : "text-black",
                  )}
                >
                  {fmtCredits(credits?.total)}
                </p>
                {!!credits?.bonus && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#00A878]">
                    <Gift className="w-3.5 h-3.5" /> includes{" "}
                    {fmtCredits(credits.bonus)} bonus credits
                    {credits.bonusExpiresAt
                      ? ` · valid till ${new Date(credits.bonusExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                      : ""}
                  </p>
                )}
                {credits?.zero ? (
                  <p className="mt-3 text-sm font-medium text-red-600">
                    WhatsApp and SMS are paused until you add credits. In-app
                    alerts, email and login codes still work.
                  </p>
                ) : credits?.low ? (
                  <p className="mt-3 text-sm font-medium text-[#FA731C]">
                    Credits are running low. Top up so trip and fee messages
                    don't stop.
                  </p>
                ) : null}
                {usage && usage.last7Days > 0 && (
                  <p className="mt-3 text-xs text-gray-600">
                    Last 7 days: {fmtCredits(usage.last7Days)} credits used (about{" "}
                    {fmtCredits(usage.perDay)} a day).
                  </p>
                )}
              </div>
              <div className="border-2 border-black bg-[#F0F7FF] p-5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                  <MessageCircle className="w-4 h-4 text-[#25D366]" /> How it's
                  charged
                </div>
                <p className="text-sm text-black">
                  <b>{credits?.rates?.whatsapp ?? 0.2} credit</b> per WhatsApp
                  message
                </p>
                <p className="text-sm text-black">
                  <b>{credits?.rates?.sms ?? 0.4} credit</b> per SMS
                </p>
                <p className="text-xs text-gray-600 flex items-start gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#024BAB]" />
                  Email and in-app alerts are free. A message the provider
                  rejects is refunded.
                </p>
              </div>
            </div>

            <div>
              <h2 className="font-display font-medium text-black mb-3">
                Add credits
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {packs.map((p) => (
                  <div
                    key={p.id}
                    className="border-2 border-black bg-white p-4 flex flex-col shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <p className="text-2xl font-medium text-black">
                      {fmtCredits(p.credits)}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                      credits
                    </p>
                    {p.bonus > 0 && (
                      <span className="mt-1 self-start border border-black bg-[#FFF4D6] px-1.5 text-[11px] font-medium">
                        +{fmtCredits(p.bonus)} free
                      </span>
                    )}
                    <p className="mt-3 text-sm font-medium text-black">
                      {inr(p.price)}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      + {gstPct}% GST = {inr(p.total)}
                    </p>
                    <button
                      onClick={() => buy(p)}
                      disabled={!!paying}
                      className="mt-3 flex items-center justify-center gap-1 border-2 border-black bg-[#024BAB] text-white text-xs font-medium py-2 hover:bg-[#013a85] disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />{" "}
                      {paying === p.id ? "Opening…" : "Add"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Credits are non-refundable once purchased.
              </p>
            </div>

            <div>
              <h2 className="font-display font-medium text-black mb-3">Usage</h2>
              <div className="flex flex-wrap gap-2 mb-3">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cx(
                      "px-3 py-1 border-2 border-black text-xs font-medium",
                      filter === f.key
                        ? "bg-black text-white"
                        : "bg-white text-black hover:bg-[#024BAB]/10",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="border-2 border-black bg-white overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#024BAB] text-white text-left">
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">What</th>
                      <th className="px-3 py-2 font-medium">To</th>
                      <th className="px-3 py-2 font-medium text-right">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-8 text-center text-gray-500 font-medium"
                        >
                          Nothing here yet
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r._id} className="border-t border-black/10">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {new Date(r.createdAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2 font-medium text-black">
                          {r.type === "topup"
                            ? "Top-up"
                            : r.type === "bonus"
                              ? "Bonus credits"
                              : CHANNEL_LABEL[r.event] || r.event || r.type}
                          {(REASON[r.note] ||
                            (r.type !== "debit" && r.note)) && (
                            <span className="block text-[11px] text-gray-500">
                              {REASON[r.note] || r.note}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.phone || "—"}
                        </td>
                        <td
                          className={cx(
                            "px-3 py-2 text-right font-medium",
                            r.credits > 0
                              ? "text-[#00A878]"
                              : r.credits === 0
                                ? "text-gray-400"
                                : "text-black",
                          )}
                        >
                          {r.credits > 0 ? "+" : ""}
                          {fmtCredits(r.credits)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length < total && (
                <button
                  onClick={() => loadLedger(page + 1, filter)}
                  className="mt-3 border-2 border-black bg-white px-4 py-1.5 text-xs font-medium hover:bg-[#024BAB]/10"
                >
                  Load more
                </button>
              )}
            </div>

            {topups.length > 0 && (
              <div>
                <h2 className="font-display font-medium text-black mb-3">
                  Top-up invoices
                </h2>
                <div className="border-2 border-black bg-white divide-y divide-black/10">
                  {topups.map((t) => (
                    <div
                      key={t._id}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-black">
                        {t.invoiceNumber}
                      </span>
                      <span className="text-gray-600">
                        {new Date(t.paidAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="text-gray-600">
                        {fmtCredits(t.credits)} credits
                      </span>
                      <span className="font-medium text-black">
                        {inr(t.total)}{" "}
                        <span className="font-normal text-gray-500">
                          (GST {inr(t.gst)})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
