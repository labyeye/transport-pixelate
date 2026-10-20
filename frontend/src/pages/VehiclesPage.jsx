import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Truck,
  UserCheck,
  Wrench,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState } from "@/components/common/DataTable";
import { VEHICLE_STATUS } from "@/components/common/StatusBadge";
import { VehicleCard } from "@/components/common/VehicleCard";
import { FadeIn } from "@/components/motion/FadeIn";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, patch, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";
const DOCS = ["insurance", "registration", "fitness", "permit", "pollution"];
const toDate = (d) => (d ? d.slice(0, 10) : "");
function VehicleForm({ vehicle, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    registrationNumber: vehicle?.registrationNumber ?? "",
    fleetNumber: vehicle?.fleetNumber ?? "",
    category: vehicle?.category ?? "bus",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year?.toString() ?? "",
    capacity: vehicle?.capacity?.toString() ?? "",
    fuelType: vehicle?.fuelType ?? "diesel",
    odometer: vehicle?.odometer?.toString() ?? "0",
    ownership: vehicle?.ownership ?? "owned",
    branch: vehicle?.branch ?? "",
  });
  const [docs, setDocs] = useState(
    Object.fromEntries(
      DOCS.map((d) => [d, toDate(vehicle?.documents?.[d]?.expiryDate)]),
    ),
  );
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        year: f.year || undefined,
        fleetNumber: f.fleetNumber || undefined,
        make: f.make || undefined,
        model: f.model || undefined,
        branch: f.branch || undefined,
        documents: Object.fromEntries(
          DOCS.filter((d) => docs[d]).map((d) => [
            d,
            { ...(vehicle?.documents?.[d] ?? {}), expiryDate: docs[d] },
          ]),
        ),
      };
      return vehicle
        ? put(`/vehicles/${vehicle._id}`, body)
        : post("/vehicles", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: vehicle ? "Vehicle updated" : "Vehicle added",
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={vehicle ? "Edit vehicle" : "Add vehicle"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-4"
      >
        {error && (
          <div
            role="alert"
            className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
          >
            {error}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Registration number" required>
            <input
              required
              className={inputCls}
              placeholder="MH12AB1234"
              value={f.registrationNumber}
              onChange={set("registrationNumber")}
            />
          </Field>
          <Field label="Fleet number">
            <input
              className={inputCls}
              value={f.fleetNumber}
              onChange={set("fleetNumber")}
            />
          </Field>
          <Field label="Category">
            <input
              className={inputCls}
              value={f.category}
              onChange={set("category")}
            />
          </Field>
          <Field label="Seating capacity" required>
            <input
              required
              type="number"
              min={1}
              className={inputCls}
              value={f.capacity}
              onChange={set("capacity")}
            />
          </Field>
          <Field label="Make">
            <input className={inputCls} value={f.make} onChange={set("make")} />
          </Field>
          <Field label="Model">
            <input
              className={inputCls}
              value={f.model}
              onChange={set("model")}
            />
          </Field>
          <Field label="Year">
            <input
              type="number"
              className={inputCls}
              value={f.year}
              onChange={set("year")}
            />
          </Field>
          <Field label="Odometer (km)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={f.odometer}
              onChange={set("odometer")}
            />
          </Field>
          <Field label="Fuel type">
            <select
              className={inputCls}
              value={f.fuelType}
              onChange={set("fuelType")}
            >
              {["diesel", "petrol", "cng", "electric", "hybrid", "other"].map(
                (x) => (
                  <option key={x} value={x}>
                    {x.toUpperCase()}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Ownership">
            <select
              className={inputCls}
              value={f.ownership}
              onChange={set("ownership")}
            >
              {["owned", "leased", "contracted"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Branch">
            <input
              className={inputCls}
              value={f.branch}
              onChange={set("branch")}
            />
          </Field>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2">
            Document expiry dates
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            {DOCS.map((d) => (
              <Field key={d} label={d}>
                <input
                  type="date"
                  className={inputCls}
                  value={docs[d]}
                  onChange={(e) => setDocs({ ...docs, [d]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save vehicle"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
function AssignDriver({ vehicle, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [driverId, setDriverId] = useState(vehicle.assignedDriver?._id ?? "");
  const [error, setError] = useState("");
  const { data } = useQuery({
    queryKey: ["drivers", "assignable"],
    queryFn: async () =>
      (await get("/drivers", { limit: 100, staffRole: "driver" })).data,
  });
  const save = useMutation({
    mutationFn: () =>
      post(`/vehicles/${vehicle._id}/assign-driver`, {
        driverId: driverId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["drivers"] });
      toast({ title: "Assignment updated", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={`Assign driver · ${vehicle.registrationNumber}`}
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
      <Field label="Driver">
        <select
          className={inputCls}
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
        >
          <option value="">— Unassigned —</option>
          {data?.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name} ({d.status.replace("_", " ")})
            </option>
          ))}
        </select>
      </Field>
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Cancel
        </button>
        <PrimaryButton disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </PrimaryButton>
      </div>
    </Modal>
  );
}
export default function VehiclesPage() {
  const { can } = useAuth();
  const canWrite = can("vehicles:write");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(null);
  const [assign, setAssign] = useState(null);
  const [archive, setArchive] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["vehicles", page, search, status],
    queryFn: () => get("/vehicles", { page, limit: 12, search, status }),
  });
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await get("/dashboard")).data,
  });
  const setVehicleStatus = useMutation({
    mutationFn: ({ id, s }) => patch(`/vehicles/${id}/status`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) =>
      toast({
        title: "Could not change status",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const archiveMut = useMutation({
    mutationFn: (id) => del(`/vehicles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Vehicle archived", variant: "success" });
      setArchive(null);
    },
    onError: (e) => {
      toast({
        title: "Cannot archive",
        description: errMsg(e),
        variant: "destructive",
      });
      setArchive(null);
    },
  });
  const v = dash.data?.vehicles;
  const filtered = !!(search || status);
  return (
    <AppLayout title="Vehicles">
      <PageHeader
        title="Fleet"
        subtitle="Vehicle records, assignments and document expiry"
        actions={
          canWrite && (
            <PrimaryButton onClick={() => setForm("new")}>
              <Plus className="w-4 h-4" /> Add vehicle
            </PrimaryButton>
          )
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total" value={v?.total ?? "—"} icon={Truck} />
        <StatCard
          label="Available"
          value={v?.available ?? "—"}
          icon={CheckCircle2}
          color="#00C48C"
        />
        <StatCard
          label="Assigned"
          value={v?.assigned ?? "—"}
          icon={UserCheck}
        />
        <StatCard
          label="Maintenance"
          value={v?.maintenance ?? "—"}
          icon={Wrench}
          color="#D97706"
        />
      </div>
      <div className="bg-white rounded-lg border-2 border-black p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <h2 className="font-display font-bold text-lg text-black mr-auto">Vehicles List</h2>
          <SearchInput
            value={search}
            onChange={(s) => {
              setSearch(s);
              setPage(1);
            }}
            placeholder="Search by registration number"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {[["", "All"], ...Object.entries(VEHICLE_STATUS).map(([k, m]) => [k, m.label])].map(([k, label]) => (
              <button
                key={k || "all"}
                type="button"
                aria-pressed={status === k}
                onClick={() => {
                  setStatus(k);
                  setPage(1);
                }}
                className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold transition-colors ${
                  status === k ? "bg-[#FA731C] text-white" : "bg-white text-black hover:bg-[#F0F6FF]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700 mb-3"
          >
            {errMsg(error)}
          </div>
        )}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-72 rounded-lg border-2 border-black/10 bg-[#024BAB]/[0.03] animate-pulse" />
            ))}
          </div>
        ) : !data?.data?.length ? (
          <EmptyState
            icon={Truck}
            title={filtered ? "No vehicles match your filters" : "No vehicles yet"}
            message={
              filtered
                ? "Try a different search or status."
                : "Add your first vehicle to start building your fleet."
            }
            action={
              !filtered && canWrite ? (
                <PrimaryButton onClick={() => setForm("new")}>Add vehicle</PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {data.data.map((r, i) => (
                <FadeIn key={r._id} delay={Math.min(i, 11) * 0.04} distance={8}>
                  <VehicleCard
                    vehicle={r}
                    canWrite={canWrite}
                    onEdit={() => setForm(r)}
                    onAssign={() => setAssign(r)}
                    onArchive={() => setArchive(r)}
                    onStatus={(s) => setVehicleStatus.mutate({ id: r._id, s })}
                  />
                </FadeIn>
              ))}
            </div>
            {data.meta?.pages > 1 && (
              <div className="flex items-center justify-between mt-5 text-sm font-semibold">
                <span className="text-gray-500">{data.meta.total} vehicles</span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={data.meta.page <= 1}
                    onClick={() => setPage(data.meta.page - 1)}
                    className="rounded-lg border-2 border-black bg-white p-1.5 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span>
                    Page {data.meta.page} of {data.meta.pages}
                  </span>
                  <button
                    disabled={data.meta.page >= data.meta.pages}
                    onClick={() => setPage(data.meta.page + 1)}
                    className="rounded-lg border-2 border-black bg-white p-1.5 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {form && (
        <VehicleForm
          vehicle={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {assign && (
        <AssignDriver vehicle={assign} onClose={() => setAssign(null)} />
      )}
      {archive && (
        <ConfirmationDialog
          danger
          title="Archive vehicle"
          message={`Archive ${archive.registrationNumber}? It will no longer appear in lists or be assignable. Trip history is kept.`}
          confirmLabel="Archive"
          busy={archiveMut.isPending}
          onConfirm={() => archiveMut.mutate(archive._id)}
          onClose={() => setArchive(null)}
        />
      )}
    </AppLayout>
  );
}
