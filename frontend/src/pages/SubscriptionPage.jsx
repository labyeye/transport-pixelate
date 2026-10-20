import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CreditCard, Truck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, post } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatDate } from "@/lib/utils";

// The API works in paise.
const rupees = (paise) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((paise ?? 0) / 100);

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

export default function SubscriptionPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = can("settings:write");
  const { data } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await get("/subscription")).data,
  });
  const [form, setForm] = useState({
    vehicles: 10,
    tier: "pro",
    billingCycle: "monthly",
    offerCode: "",
  });
  const [error, setError] = useState("");
  const [quote, setQuote] = useState(null);

  // Start from what is currently owned, never below what is already in use.
  useEffect(() => {
    if (!data) return;
    setForm((f) => ({
      ...f,
      vehicles: Math.max(data.usage.vehicles, data.subscription.vehicleLimit, 1),
      tier: data.subscription.tier,
    }));
  }, [data]);

  // Live price, always computed by the server so what is shown is what is charged.
  useEffect(() => {
    if (!canManage || !form.vehicles) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const body = {
          vehicles: Number(form.vehicles),
          tier: form.tier,
          billingCycle: form.billingCycle,
        };
        if (form.offerCode.trim()) body.offerCode = form.offerCode.trim();
        const q = (await post("/subscription/quote", body)).data;
        if (live) {
          setQuote(q);
          setError("");
        }
      } catch (e) {
        if (live) {
          setQuote(null);
          setError(errMsg(e));
        }
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [form, canManage]);

  const pay = useMutation({
    mutationFn: async () => {
      const body = {
        vehicles: Number(form.vehicles),
        tier: form.tier,
        billingCycle: form.billingCycle,
      };
      if (form.offerCode.trim()) body.offerCode = form.offerCode.trim();
      const o = (await post("/subscription/order", body)).data;
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: o.keyId,
          amount: o.total,
          currency: o.currency,
          order_id: o.orderId,
          name: "Nest Transport",
          description: `${form.tier === "pro" ? "Pro" : "Basic"} · ${body.vehicles} vehicles`,
          // Checkout's callback is only a hint: the server verifies the signature and amount before activating.
          handler: async (resp) => {
            try {
              resolve(await post("/subscription/verify", resp));
            } catch (e) {
              reject(e);
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment window closed")) },
        });
        rz.open();
      });
    },
    onSuccess: () => {
      setError("");
      toast({ title: "Subscription active", variant: "success" });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const s = data?.subscription;
  const status = !s
    ? "…"
    : !s.ok
      ? s.reason === "trial_expired"
        ? "Trial ended"
        : "Expired"
      : s.isTrial
        ? `Trial · ${Math.max(s.daysLeft, 0)} day${s.daysLeft === 1 ? "" : "s"} left`
        : "Active";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <AppLayout title="Subscription">
      <PageHeader
        title="Subscription"
        subtitle="Priced per active vehicle, per month. GST is added at checkout."
      />
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <StatCard label="Status" value={status} icon={CreditCard} />
        <StatCard
          label={s?.isTrial ? "Trial ends" : "Paid until"}
          value={s?.endsAt ? formatDate(s.endsAt) : "—"}
          icon={CalendarClock}
        />
        <StatCard
          label="Vehicles used"
          value={`${data?.usage.vehicles ?? 0} / ${s?.vehicleLimit ?? 0}`}
          icon={Truck}
        />
      </div>

      {!canManage ? (
        <p className="text-sm font-semibold">
          Only an owner or admin can change the plan.
        </p>
      ) : (
        <div className="border-2 border-black bg-white p-4 max-w-xl space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vehicles">
              <input
                type="number"
                min={Math.max(data?.usage.vehicles ?? 1, 1)}
                className={inputCls}
                value={form.vehicles}
                onChange={set("vehicles")}
              />
            </Field>
            <Field label="Billing">
              <select
                className={inputCls}
                value={form.billingCycle}
                onChange={set("billingCycle")}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly (12 months)</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(data?.plans ?? {}).map(([k, p]) => (
              <label
                key={k}
                className={`border-2 p-3 cursor-pointer ${form.tier === k ? "border-[#024BAB] bg-[#024BAB]/5" : "border-black"}`}
              >
                <input
                  type="radio"
                  name="tier"
                  className="mr-2"
                  checked={form.tier === k}
                  onChange={() => setForm({ ...form, tier: k })}
                />
                <span className="font-bold capitalize">{k}</span>
                <span className="block text-xs font-medium mt-1">
                  {p.label}
                </span>
                <span className="block text-sm font-bold mt-1">
                  {rupees(p.ratePerVehicle)} / vehicle / month
                </span>
              </label>
            ))}
          </div>
          <Field label="Offer code (optional)">
            <input
              className={inputCls}
              value={form.offerCode}
              onChange={set("offerCode")}
              placeholder="e.g. WELCOME"
            />
          </Field>

          {quote && (
            <dl className="text-sm font-medium border-t-2 border-black pt-3 space-y-1">
              <div className="flex justify-between">
                <dt>
                  {form.vehicles} vehicles × {rupees(quote.rate)}
                  {form.billingCycle === "yearly" ? " × 12" : ""}
                </dt>
                <dd>{rupees(quote.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>GST ({quote.gstRate}%)</dt>
                <dd>{rupees(quote.gstAmount)}</dd>
              </div>
              {quote.bonusMonths > 0 && (
                <div className="flex justify-between">
                  <dt>Bonus</dt>
                  <dd>+{quote.bonusMonths} months free</dd>
                </div>
              )}
              <div className="flex justify-between font-bold text-base">
                <dt>Total</dt>
                <dd>{rupees(quote.total)}</dd>
              </div>
            </dl>
          )}
          {error && (
            <div
              role="alert"
              className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
            >
              {error}
            </div>
          )}
          {data && !data.paymentsConfigured && (
            <p className="text-xs font-semibold">
              Online payment is not configured on this server yet.
            </p>
          )}
          <PrimaryButton
            disabled={!quote || pay.isPending || !data?.paymentsConfigured}
            onClick={() => pay.mutate()}
          >
            {pay.isPending ? "Opening payment…" : "Pay & activate"}
          </PrimaryButton>
        </div>
      )}
    </AppLayout>
  );
}
