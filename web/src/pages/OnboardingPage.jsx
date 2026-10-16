import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, Building2, Check, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { get, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/Toaster";
import { BrandMark } from "@/components/common/BrandMark";
import { PhoneField } from "@/components/common/PhoneField";
import { authInput } from "@/components/common/AuthShell";
import { Field } from "@/components/common/AuthFields";
import { DEFAULT_COUNTRY, phoneError, toE164 } from "@/lib/countries";
import { cn } from "@/lib/utils";

// Same wizard as NestHR: Company -> Fleet size -> Plan -> Payment, then /welcome.
const STEPS = [
  { id: "company", label: "Company" },
  { id: "fleet", label: "Fleet size" },
  { id: "plan", label: "Plan" },
  { id: "payment", label: "Payment" },
];
const FEATURE_LABELS = {
  whatsapp: "WhatsApp notifications",
  billing: "Passenger fee billing",
  parentAccess: "Parent access",
};
const BASE_FEATURES = [
  "Vehicles, drivers & routes",
  "Trip dispatch & live tracking",
  "Driver mobile app",
  "Maintenance, fuel & documents",
  "Reports & email notifications",
];
const GST_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function StepIndicator({ current }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center mb-10">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-9 h-9 rounded-lg border-2 border-black flex items-center justify-center font-bold text-sm transition-all",
                  done && "bg-[#024BAB] text-white",
                  active && "bg-[#FA731C] text-white",
                  !done && !active && "bg-white text-gray-400",
                )}
              >
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase mt-1 tracking-wide",
                  active ? "text-[#FA731C]" : done ? "text-[#024BAB]" : "text-gray-400",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("w-10 sm:w-16 h-0.5 mt-[-14px] mx-1", i < idx ? "bg-[#024BAB]" : "bg-gray-200")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const primaryBtn =
  "w-full bg-[#024BAB] text-white border-2 border-black font-bold uppercase text-sm px-4 py-3 flex items-center justify-center gap-2 hover:bg-[#023590] disabled:opacity-60 disabled:cursor-not-allowed transition-all";

export default function OnboardingPage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState("company");
  const [co, setCo] = useState({
    organizationName: "",
    category: "school",
    phone: { iso: DEFAULT_COUNTRY, number: "" },
    address: "",
    gstNumber: "",
  });
  const [touched, setTouched] = useState({});
  const [companyError, setCompanyError] = useState("");
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState("");
  const [tier, setTier] = useState("basic");
  const [cycle, setCycle] = useState("monthly");
  const [sub, setSub] = useState(null); // GET /subscription: plans + whether payments are configured
  const [quote, setQuote] = useState(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    get("/subscription").then((r) => setSub(r.data)).catch(() => {});
    // Prefill the name the account was created with (it is only a placeholder until this step).
    get("/settings/organization")
      .then((r) => setCo((c) => ({ ...c, organizationName: r.data.name, category: r.data.category })))
      .catch(() => {});
  }, []);

  const count = Number(vehicles) || 0;
  useEffect(() => {
    if (step !== "plan" && step !== "payment") return;
    let live = true;
    post("/subscription/quote", { vehicles: count, tier, billingCycle: cycle })
      .then((r) => live && setQuote(r.data))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [step, count, tier, cycle]);

  if (user?.onboarded) return <Navigate to="/" replace />;

  const errors = {};
  const org = co.organizationName.trim();
  if (org.length < 2) errors.organizationName = "Enter at least 2 characters";
  else if (org.length > 120) errors.organizationName = "Keep it under 120 characters";
  const pe = phoneError(co.phone.iso, co.phone.number);
  if (pe) errors.phone = pe;
  if (co.gstNumber && !GST_RE.test(co.gstNumber)) errors.gstNumber = "Format: 27AABCT1234A1Z5";
  if (co.address.length > 300) errors.address = "Keep it under 300 characters";
  const err = (k) => (touched[k] ? errors[k] : undefined);
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const bad = (k) => (err(k) ? "!border-red-500" : "");

  const saveCompany = async (complete) =>
    (
      await put("/auth/onboarding", {
        organizationName: org,
        category: co.category,
        phone: toE164(co.phone.iso, co.phone.number),
        address: co.address.trim() || undefined,
        gstNumber: co.gstNumber || undefined,
        complete,
      })
    ).data;

  const submitCompany = async (e) => {
    e.preventDefault();
    if (Object.keys(errors).length) {
      setTouched({ organizationName: true, phone: true, gstNumber: true, address: true });
      return;
    }
    setSaving(true);
    setCompanyError("");
    try {
      await saveCompany(false);
      setStep("fleet");
    } catch (e2) {
      setCompanyError(errMsg(e2));
    } finally {
      setSaving(false);
    }
  };

  const fleetContinue = () => {
    if (count < 1) {
      toast({ title: "Enter fleet size", description: "How many vehicles will you manage?", variant: "destructive" });
      return;
    }
    setStep("plan");
  };

  const finish = async () => {
    const u = await saveCompany(true);
    updateUser(u);
    setTimeout(() => navigate("/welcome", { replace: true }), 600);
  };

  const startTrial = async () => {
    setPaying(true);
    try {
      await finish();
    } catch (e) {
      toast({ title: "Could not continue", description: errMsg(e), variant: "destructive" });
      setPaying(false);
    }
  };

  const pay = async () => {
    setPaying(true);
    try {
      const order = (await post("/subscription/order", { vehicles: count, tier, billingCycle: cycle })).data;
      if (!(await loadRazorpay())) throw new Error("Failed to load payment checkout. Check your connection.");
      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.total,
          currency: order.currency || "INR",
          name: "Nest Transport",
          description: `Nest Transport — ${sub?.plans?.[tier]?.label ?? tier} — ${count} vehicles`,
          theme: { color: "#024BAB" },
          handler: async (r) => {
            try {
              await post("/subscription/verify", r);
              toast({ title: "Payment successful", description: "Subscription activated.", variant: "success" });
              await finish();
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
        });
        rzp.open();
      });
    } catch (e) {
      if (e.message !== "Payment cancelled")
        toast({ title: "Could not complete payment", description: errMsg(e), variant: "destructive" });
      setPaying(false);
    }
  };

  const plans = sub?.plans ?? {};
  const paymentsOn = sub?.paymentsConfigured;
  const planLabel = plans[tier]?.label ?? tier;

  return (
    <div className="min-h-screen bg-[#F0F6FF]">
      <header className="bg-white border-b-2 border-black sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <BrandMark className="h-10" />
          <button onClick={logout} className="text-sm font-bold text-black hover:text-[#024BAB] transition-colors">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <StepIndicator current={step} />

        {step === "company" && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-display font-bold text-3xl text-black mb-2">Set up your organization</h1>
              <p className="text-gray-500 font-medium text-sm">Your legal and contact details</p>
            </div>
            <div className="bg-white rounded-lg border-2 border-black p-6 sm:p-8 max-w-2xl mx-auto">
              <form onSubmit={submitCompany} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                {companyError && (
                  <div className="sm:col-span-2 flex items-start gap-3 rounded-lg bg-white border-2 border-[#EF4444] px-4 py-3">
                    <AlertCircle className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
                    <span className="text-sm font-medium text-[#EF4444]">{companyError}</span>
                  </div>
                )}
                <Field label="Organization name *" htmlFor="org" error={err("organizationName")}>
                  <input
                    id="org"
                    autoFocus
                    className={`${authInput} ${bad("organizationName")}`}
                    value={co.organizationName}
                    onChange={(e) => setCo({ ...co, organizationName: e.target.value })}
                    onBlur={touch("organizationName")}
                    placeholder="e.g. Greenfield Public School"
                    maxLength={120}
                  />
                </Field>
                <Field label="Type" htmlFor="cat">
                  <select
                    id="cat"
                    className={authInput}
                    value={co.category}
                    onChange={(e) => setCo({ ...co, category: e.target.value })}
                  >
                    <option value="school">School</option>
                    <option value="employee">Employee transport</option>
                    <option value="institution">Institution</option>
                    <option value="contractor">Transport contractor</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Mobile number *" htmlFor="phone" error={err("phone")}>
                  <PhoneField
                    id="phone"
                    value={co.phone}
                    onChange={(phone) => setCo({ ...co, phone })}
                    onBlur={touch("phone")}
                    error={err("phone")}
                  />
                </Field>
                <Field label="GST number" htmlFor="gst" error={err("gstNumber")}>
                  <input
                    id="gst"
                    className={`${authInput} ${bad("gstNumber")}`}
                    value={co.gstNumber}
                    onChange={(e) =>
                      setCo({ ...co, gstNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) })
                    }
                    onBlur={touch("gstNumber")}
                    placeholder="27AABCT1234A1Z5"
                  />
                </Field>
                <Field label="Address" htmlFor="addr" error={err("address")} className="sm:col-span-2">
                  <input
                    id="addr"
                    className={`${authInput} ${bad("address")}`}
                    value={co.address}
                    onChange={(e) => setCo({ ...co, address: e.target.value })}
                    onBlur={touch("address")}
                    placeholder="Street, city, state, PIN"
                    maxLength={300}
                  />
                </Field>
                <button type="submit" disabled={saving} className={`${primaryBtn} sm:col-span-2`}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Building2 className="w-4 h-4" /> Continue to fleet size
                    </>
                  )}
                </button>
                <p className="sm:col-span-2 text-xs text-gray-600 text-center font-medium">* Required fields</p>
              </form>
            </div>
          </div>
        )}

        {step === "fleet" && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-display font-bold text-3xl text-black mb-2">How big is your fleet?</h1>
              <p className="text-gray-500 font-medium text-sm">
                We will recommend the right plan based on the number of vehicles
              </p>
            </div>
            <div className="bg-white rounded-lg border-2 border-black p-8 max-w-sm mx-auto">
              <label className="block text-xs font-bold uppercase tracking-wider text-black mb-3" htmlFor="veh">
                Number of vehicles
              </label>
              <input
                id="veh"
                type="number"
                min={1}
                max={100000}
                value={vehicles}
                onChange={(e) =>
                  setVehicles(e.target.value === "" ? "" : Math.min(100000, Math.max(1, parseInt(e.target.value) || 1)))
                }
                placeholder="e.g. 12"
                autoFocus
                className="w-full rounded-lg border-2 border-black px-4 py-3 text-2xl font-bold text-center focus:outline-none mb-2"
              />
              <p className="text-xs text-gray-400 font-medium text-center mb-6">
                Buses, vans, cars and any other vehicle you dispatch
              </p>
              <div className="grid grid-cols-4 gap-2 mb-6">
                {[5, 10, 25, 50].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVehicles(n)}
                    className={cn(
                      "py-2 rounded-lg text-sm font-bold border-2 border-black transition-all",
                      count === n ? "bg-[#024BAB] text-white" : "bg-white text-black hover:bg-gray-50",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button onClick={fleetContinue} className={primaryBtn}>
                Continue <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setStep("company")}
                className="w-full text-center text-xs text-gray-400 hover:text-black font-bold mt-3 transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {step === "plan" && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-display font-bold text-3xl text-black mb-2">Choose your plan</h1>
              <p className="text-gray-500 font-medium text-sm">
                Priced per vehicle — for your fleet of {count}
              </p>
            </div>
            <div className="flex justify-center mb-6">
              <div className="inline-flex rounded-lg border-2 border-black overflow-hidden">
                {["monthly", "yearly"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCycle(c)}
                    className={cn(
                      "px-5 py-2 text-xs font-bold uppercase",
                      cycle === c ? "bg-[#024BAB] text-white" : "bg-white text-black",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-3xl mx-auto">
              {Object.entries(plans).map(([k, p]) => {
                const selected = tier === k;
                const perCycle = p.ratePerVehicle * count * (cycle === "yearly" ? 12 : 1);
                const extras = Object.entries(p.features ?? {})
                  .filter(([, on]) => on)
                  .map(([f]) => FEATURE_LABELS[f] ?? f);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTier(k)}
                    className={cn(
                      "text-left rounded-lg border-2 bg-white p-5 flex flex-col transition-all",
                      selected ? "border-[#024BAB] ring-2 ring-[#024BAB]" : "border-black hover:border-[#024BAB]",
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-display font-bold text-lg text-black">{p.label}</h3>
                      {selected && <Check className="w-5 h-5 text-[#024BAB] shrink-0" />}
                    </div>
                    <div className="my-4 pb-4 border-b-2 border-black">
                      <div className="font-display font-bold text-2xl text-[#024BAB]">{rupees(p.ratePerVehicle)}</div>
                      <div className="text-xs text-gray-500 font-medium">/vehicle/month + GST</div>
                      <div className="text-xs text-gray-600 font-bold mt-1">
                        {rupees(perCycle)} / {cycle === "yearly" ? "year" : "month"} before GST
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {[...BASE_FEATURES, ...extras].map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs">
                          <Check className="w-3.5 h-3.5 text-[#024BAB] shrink-0 mt-0.5" />
                          <span className="text-gray-700 font-medium">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            <div className="max-w-sm mx-auto">
              <button onClick={() => setStep("payment")} className={primaryBtn} disabled={!sub}>
                Continue to Payment <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setStep("fleet")}
                className="w-full text-center text-xs text-gray-400 hover:text-black font-bold mt-3 transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {step === "payment" && (
          <div>
            <div className="text-center mb-8">
              <h1 className="font-display font-bold text-3xl text-black mb-2">Confirm & Pay</h1>
              <p className="text-gray-500 font-medium text-sm">
                A secure Razorpay checkout will open to complete your payment
              </p>
            </div>
            <div className="max-w-md mx-auto space-y-4">
              <div className="bg-white rounded-lg border-2 border-black overflow-hidden">
                <div className="p-5 border-b-2 border-black bg-[#F0F6FF]">
                  <p className="font-bold text-xs uppercase text-gray-500">Order Summary</p>
                </div>
                <div className="p-5 space-y-3 text-sm">
                  <Row k="Plan" v={planLabel} />
                  <Row k="Vehicles" v={count} />
                  <Row k="Billing" v={cycle === "yearly" ? "Yearly" : "Monthly"} />
                  {quote && (
                    <>
                      <Row k="Subtotal" v={rupees(quote.subtotal)} />
                      <Row k={`GST (${quote.gstRate}%)`} v={rupees(quote.gstAmount)} />
                      <div className="border-t-2 border-black pt-3 flex justify-between items-center">
                        <span className="font-bold text-sm uppercase">Total</span>
                        <span className="font-bold text-xl text-[#024BAB]">{rupees(quote.total)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button onClick={pay} disabled={paying || !paymentsOn || !quote} className={`${primaryBtn} py-4`}>
                {paying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Opening checkout...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-5 h-5" /> Pay {quote ? rupees(quote.total) : ""} via Razorpay
                  </>
                )}
              </button>
              {!paymentsOn && sub && (
                <p className="text-xs text-center font-medium text-gray-500">
                  Online payment is not set up on this server yet.
                </p>
              )}
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400 font-medium">
                <AlertCircle className="w-3.5 h-3.5" /> Secured by Razorpay · PCI-DSS compliant
              </div>
              <button
                onClick={startTrial}
                disabled={paying}
                className="w-full rounded-lg border-2 border-black bg-white text-black font-bold text-sm px-4 py-3 disabled:opacity-60"
              >
                Start free trial instead
              </button>
              <button
                onClick={() => setStep("plan")}
                className="w-full text-center text-xs text-gray-400 hover:text-black font-bold transition-colors"
              >
                ← Back to plan selection
              </button>
            </div>
          </div>
        )}
      </main>
      <Toaster />
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between items-center">
      <span className="font-bold text-gray-600">{k}</span>
      <span className="font-bold text-black">{v}</span>
    </div>
  );
}
