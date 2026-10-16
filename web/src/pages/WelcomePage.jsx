import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle, MapPin, Route, ShieldCheck, Truck, Users, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandMark } from "@/components/common/BrandMark";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Truck, label: "Fleet & Vehicles", color: "#024BAB" },
  { icon: Users, label: "Drivers & Staff", color: "#FA731C" },
  { icon: Route, label: "Routes & Trip Dispatch", color: "#00C48C" },
  { icon: MapPin, label: "Live Tracking", color: "#A855F7" },
  { icon: Wallet, label: "Fees & Billing", color: "#EF4444" },
  { icon: ShieldCheck, label: "Documents & Compliance", color: "#F59E0B" },
];
const STEPS = [
  { num: "01", title: "Add your vehicles", desc: "Register each bus, van or car with its documents" },
  { num: "02", title: "Add drivers and routes", desc: "Assign drivers and plan stops and timings" },
  { num: "03", title: "Dispatch your first trip", desc: "Track it live from the dashboard" },
];

// Same landing as NestHR after onboarding: hero, feature grid, quick checklist, 10s redirect to the dashboard.
export default function WelcomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const [stepsVisible, setStepsVisible] = useState(false);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    const t = [
      setTimeout(() => setVisible(true), 100),
      setTimeout(() => setFeaturesVisible(true), 600),
      setTimeout(() => setStepsVisible(true), 1000),
      setTimeout(() => setCountdown(10), 1400),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      navigate("/", { replace: true });
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  const firstName = user?.name?.split(" ")[0] || "there";
  const reveal = (on) =>
    cn("transition-all duration-700 ease-out", on ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8");

  return (
    <div className="min-h-screen bg-[#F0F6FF] flex flex-col overflow-hidden">
      <header className="bg-white border-b-2 border-black">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center">
          <BrandMark className="h-10" />
        </div>
      </header>
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12 flex flex-col gap-10">
        <div className={reveal(visible)}>
          <div className="bg-white rounded-lg border-2 border-black overflow-hidden">
            <div className="bg-[#024BAB] px-8 py-10 relative overflow-hidden">
              <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                  backgroundImage: "repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)",
                  backgroundSize: "14px 14px",
                }}
              />
              <div className="flex items-center gap-4 mb-5 relative">
                <div className="w-14 h-14 rounded-lg bg-white border-2 border-black flex items-center justify-center shrink-0 animate-bounce">
                  <CheckCircle className="w-7 h-7 text-[#024BAB]" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-0.5">
                    Workspace ready
                  </p>
                  <p className="text-white font-bold text-lg leading-tight">Your organization is set up</p>
                </div>
              </div>
              <h1 className="font-display font-bold text-3xl sm:text-4xl text-white leading-tight">
                Welcome aboard,
                <br />
                <span className="text-[#FA731C]">{firstName}!</span>
              </h1>
              <p className="mt-3 text-white/80 text-sm font-medium max-w-md">
                Your Nest Transport workspace is live. Everything you need to run your fleet — vehicles, drivers,
                routes, trips and fees — is ready.
              </p>
            </div>
            <div className="px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 border-t-2 border-black bg-white">
              <p className="text-sm font-bold text-gray-500">
                {countdown !== null ? (
                  <>
                    Redirecting to your dashboard in{" "}
                    <span className="text-[#024BAB] font-bold tabular-nums">{countdown}s</span>
                  </>
                ) : (
                  "Your workspace is ready"
                )}
              </p>
              <button
                onClick={() => navigate("/", { replace: true })}
                className="flex items-center gap-2 rounded-lg bg-[#FA731C] text-white border-2 border-black font-bold uppercase text-sm px-6 py-3 hover:bg-[#e06419] transition-all active:scale-95"
              >
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className={reveal(featuresVisible)}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">
            Everything included in your plan
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FEATURES.map(({ icon: Icon, label, color }) => (
              <div
                key={label}
                className="bg-white rounded-lg border-2 border-black px-4 py-3 flex items-center gap-3 hover:border-[#024BAB] transition-colors"
              >
                <div
                  className="w-8 h-8 rounded-lg border-2 border-black flex items-center justify-center shrink-0"
                  style={{ backgroundColor: color + "15" }}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <span className="text-xs font-bold text-black">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={reveal(stepsVisible)}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Quick setup checklist</p>
          <div className="bg-white rounded-lg border-2 border-black overflow-hidden divide-y-2 divide-black">
            {STEPS.map(({ num, title, desc }) => (
              <div key={num} className="flex items-center gap-5 px-6 py-5 hover:bg-[#F8FAFF] transition-colors">
                <div className="w-10 h-10 rounded-lg bg-[#024BAB] border-2 border-black flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-xs">{num}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-black">{title}</p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">{desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        <p className={cn("text-center text-xs text-gray-400 font-medium", reveal(stepsVisible))}>
          Need help?{" "}
          <a href="mailto:support@pixelatenest.com" className="text-[#024BAB] font-bold underline">
            support@pixelatenest.com
          </a>
        </p>
      </main>
    </div>
  );
}
