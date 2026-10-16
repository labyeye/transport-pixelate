import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Truck,
  Users,
  Wrench,
  Navigation,
  Fuel,
  Receipt,
  ClipboardList,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/common/DataTable";
import { get } from "@/services/api";
import { formatCurrency, formatDate } from "@/lib/utils";
export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await get("/dashboard")).data,
  });
  return (
    <AppLayout title="Dashboard">
      <PageHeader
        title="Transport operations"
        subtitle="Live counts from your fleet records"
      />
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700 mb-4"
        >
          Could not load the dashboard.
        </div>
      )}
      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 border-2 border-black bg-white animate-pulse"
            />
          ))}
        </div>
      )}
      {data && data.vehicles.total === 0 && data.drivers.total === 0 && (
        <EmptyState
          icon={Truck}
          title="Let's set up your fleet"
          message="Add your first vehicle and driver. Routes, trips and tracking build on these records."
          action={
            <Link to="/vehicles">
              <PrimaryButton>Add a vehicle</PrimaryButton>
            </Link>
          }
        />
      )}
      {data && (data.vehicles.total > 0 || data.drivers.total > 0) && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatCard
              delay={0.0}
              label="Total vehicles"
              value={data.vehicles.total}
              icon={Truck}
            />
            <StatCard
              delay={0.05}
              label="Available"
              value={data.vehicles.available}
              icon={CheckCircle2}
              color="#00C48C"
            />
            <StatCard
              delay={0.1}
              label="On trip"
              value={data.vehicles.onTrip}
              icon={Navigation}
              color="#FA731C"
            />
            <StatCard
              delay={0.15}
              label="Maintenance"
              value={data.vehicles.maintenance}
              icon={Wrench}
              color="#D97706"
            />
            <StatCard
              delay={0.2}
              label="Total drivers"
              value={data.drivers.total}
              icon={Users}
            />
            <StatCard
              delay={0.25}
              label="On duty"
              value={data.drivers.onDuty}
              icon={Users}
              color="#FA731C"
            />
            <StatCard
              delay={0.3}
              label="On leave"
              value={data.drivers.onLeave}
              icon={Users}
              color="#D97706"
            />
            <StatCard
              delay={0.35}
              label="Trips today"
              value={data.trips.today}
              icon={Navigation}
            />
            <StatCard
              delay={0.4}
              label="Trips in progress"
              value={data.trips.inProgress}
              icon={Navigation}
              color="#FA731C"
            />
            <StatCard
              delay={0.45}
              label="Completed today"
              value={data.trips.completed}
              icon={CheckCircle2}
              color="#00C48C"
            />
            <StatCard
              delay={0.5}
              label="Delayed / cancelled"
              value={data.trips.delayed + data.trips.cancelled}
              icon={AlertTriangle}
              color="#EF4444"
            />
            <StatCard
              delay={0.55}
              label="Open maintenance"
              value={data.maintenance.open}
              icon={Wrench}
              color="#D97706"
            />
            {data.costs && (
              <StatCard
              delay={0.6}
                label="Fuel this month"
                value={formatCurrency(data.costs.fuel)}
                icon={Fuel}
              />
            )}
            {data.costs && (
              <StatCard
              delay={0.65}
                label="Pending expenses"
                value={data.costs.pendingExpenses}
                icon={Receipt}
                color="#FA731C"
              />
            )}
            {data.requests && (
              <StatCard
              delay={0.7}
                label="Requests to review"
                value={data.requests.pending}
                icon={ClipboardList}
                color="#FA731C"
              />
            )}
            <StatCard
              delay={0.75}
              label="Out of service"
              value={data.vehicles.outOfService}
              icon={AlertTriangle}
              color="#EF4444"
            />
          </div>
          <div className="border-2 border-black bg-white">
            <div className="px-4 py-3 border-b-2 border-black bg-[#024BAB]/5 font-bold">
              Document expiries (next 30 days)
            </div>
            {data.expiries.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground font-medium">
                Nothing expiring soon.
              </p>
            ) : (
              <ul>
                {data.expiries.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between px-4 py-2.5 border-b border-black/10 last:border-0 text-sm"
                  >
                    <span className="font-semibold capitalize">
                      {e.label} · {e.document}
                    </span>
                    <span
                      className={`nb-badge ${e.expired ? "nb-tag-red" : "nb-tag-yellow"}`}
                    >
                      {e.expired ? "Expired " : "Expires "}
                      {formatDate(e.expiryDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-medium mt-4">
            Counts come from live records. Today's figures follow your
            organization's timezone.
          </p>
        </>
      )}
    </AppLayout>
  );
}
