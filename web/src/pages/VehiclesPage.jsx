import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Pencil,
  Plus,
  Truck,
  UserCheck,
  Wrench,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { StatusBadge, VEHICLE_STATUS } from "@/components/common/StatusBadge";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, patch, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatDateOrDash } from "@/lib/utils";
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
    queryFn: () => get("/vehicles", { page, limit: 15, search, status }),
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
      <div className="flex flex-wrap gap-2 mb-4">
        <SearchInput
          value={search}
          onChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          placeholder="Search by registration number"
        />
        <FilterSelect
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          all="All Status"
          options={Object.entries(VEHICLE_STATUS).map(([value, m]) => ({
            value,
            label: m.label,
          }))}
        />
      </div>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700 mb-3"
        >
          {errMsg(error)}
        </div>
      )}
      <DataTable
        loading={isLoading}
        rows={data?.data ?? []}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={Truck}
            title={
              filtered ? "No vehicles match your filters" : "No vehicles yet"
            }
            message={
              filtered
                ? "Try a different search or status."
                : "Add your first vehicle to start building your fleet."
            }
            action={
              !filtered && canWrite ? (
                <PrimaryButton onClick={() => setForm("new")}>
                  Add vehicle
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Registration",
            cell: (r) => (
              <span className="font-bold">{r.registrationNumber}</span>
            ),
          },
          {
            header: "Vehicle",
            cell: (r) =>
              `${[r.make, r.model].filter(Boolean).join(" ") || r.category} · ${r.capacity} seats`,
          },
          { header: "Driver", cell: (r) => r.assignedDriver?.name ?? "—" },
          {
            header: "Odometer",
            cell: (r) => `${r.odometer.toLocaleString("en-IN")} km`,
          },
          {
            header: "Nearest expiry",
            cell: (r) => {
              const d = Object.values(r.documents ?? {})
                .map((x) => x?.expiryDate)
                .filter(Boolean)
                .sort()[0];
              return d && new Date(d) < new Date() ? (
                <span className="nb-badge nb-tag-red">
                  Expired {formatDateOrDash(d)}
                </span>
              ) : (
                formatDateOrDash(d)
              );
            },
          },
          {
            header: "Status",
            cell: (r) => <StatusBadge meta={VEHICLE_STATUS[r.status]} />,
          },
          ...(canWrite
            ? [
                {
                  header: "Actions",
                  cell: (r) => (
                    <div className="flex items-center gap-1">
                      <button
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => setForm(r)}
                        className="border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Assign driver"
                        aria-label="Assign driver"
                        onClick={() => setAssign(r)}
                        className="border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                      <select
                        aria-label="Change status"
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          setVehicleStatus.mutate({
                            id: r._id,
                            s: e.target.value,
                          })
                        }
                        className="border-2 border-black bg-white text-xs font-bold px-1 py-1.5"
                      >
                        <option value="">Set status…</option>
                        <option value="available">Available</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="out_of_service">Out of service</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      <button
                        title="Archive"
                        aria-label="Archive"
                        onClick={() => setArchive(r)}
                        className="border-2 border-black p-1.5 hover:bg-red-50"
                      >
                        <Archive className="w-3.5 h-3.5 text-red-600" />
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
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
