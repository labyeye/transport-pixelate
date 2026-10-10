import { MapPin, Route, ShieldCheck, Truck, Users, Wallet } from "lucide-react";
import { BrandMark } from "@/components/common/BrandMark";
import { PoweredBy } from "@/components/common/BrandImages";

const FEATURES = [
  { icon: Truck, label: "Fleet & Vehicles" },
  { icon: Users, label: "Drivers & Staff" },
  { icon: Route, label: "Routes & Trip Dispatch" },
  { icon: MapPin, label: "Live Tracking" },
  { icon: Wallet, label: "Fees & Billing" },
  { icon: ShieldCheck, label: "Documents & Compliance" },
];

/** Split-screen auth layout. Structure and classes mirror Nest Play's LoginPage so the products feel identical. */
export function AuthShell({ children }) {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-[#024BAB] flex-col justify-between p-10 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10">
          <div className="inline-block bg-white p-2 border-2 border-black">
            <BrandMark />
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl xl:text-5xl font-display font-bold text-white leading-tight mb-5">
            Every vehicle.
            <br />
            Every trip.
            <br />
            One place.
          </h1>
          <p className="text-white/70 text-base font-medium max-w-sm">
            Manage your fleet, drivers, routes, trips and fees — with live
            tracking you can trust — all from a single dashboard.
          </p>
        </div>
        <div className="relative z-10 flex flex-wrap gap-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-2 text-white text-sm font-bold"
            >
              <Icon className="w-4 h-4 text-white/70" />
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-white flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8">
            <BrandMark />
          </div>
          {children}
          <div className="flex justify-center mt-8">
            <PoweredBy />
          </div>
        </div>
      </div>
    </div>
  );
}

export const authLabel =
  "block text-xs font-bold text-black uppercase tracking-wider mb-1.5";
export const authInput =
  "w-full px-4 py-3 border-2 border-black text-sm font-medium bg-white focus:outline-none focus:border-[#024BAB] transition-colors";
export const authButton =
  "w-full bg-[#024BAB] text-white py-3.5 text-sm font-bold border-2 border-black hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_#0a0a0a] transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-60";
