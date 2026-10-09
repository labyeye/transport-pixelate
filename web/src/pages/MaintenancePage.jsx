import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Wrench } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AttachButton, Attachments } from "@/components/common/Attachments";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, post } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatCurrency, formatDateOrDash } from "@/lib/utils";

const STATUS = {
  reported: { label: "Reported", tone: "blue" },
  scheduled: { label: "Scheduled", tone: "purple" },
  in_progress: { label: "In workshop", tone: "orange" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};
const PRIORITY = {
  low: "gray",
  medium: "blue",
  high: "orange",
  critical: "red",
};
const TYPES = [
  ["preventive", "Preventive"],
  ["breakdown", "Breakdown"],
  ["scheduled_service", "Scheduled service"],
  ["repair", "Repair"],
  ["inspection", "Inspection"],
];
const NEXT = {
  reported: [
    { to: "scheduled", label: "Schedule" },
    { to: "in_progress", label: "Start work" },
    { to: "cancelled", label: "Cancel", danger: true },
  ],
  scheduled: [
    { to: "in_progress", label: "Start work" },
    { to: "cancelled", label: "Cancel", danger: true },
  ],
  in_progress: [
    { to: "completed", label: "Complete" },
    { to: "cancelled", label: "Cancel", danger: true },
  ],
};
const d = (v) => (v ? String(v).slice(0, 10) : "");

function MaintForm({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const vehicles = useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });
  const [f, setF] = useState({
    vehicle: "",
    type: "repair",
    issue: "",
    description: "",
    priority: "medium",
    scheduledDate: "",
    workshop: "",
    nextServiceDate: "",
    nextServiceOdometer: "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      post(
        "/maintenance",
        Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Maintenance record created", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Report / schedule maintenance" onClose={onClose} wide>
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
          <Field label="Type">
            <select className={inputCls} value={f.type} onChange={set("type")}>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Issue" required>
            <input
              required
              minLength={3}
              className={inputCls}
              value={f.issue}
              onChange={set("issue")}
            />
          </Field>
          <Field label="Priority">
            <select
              className={inputCls}
              value={f.priority}
              onChange={set("priority")}
            >
              {Object.keys(PRIORITY).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scheduled date">
            <input
              type="date"
              className={inputCls}
              value={f.scheduledDate}
              onChange={set("scheduledDate")}
            />
          </Field>
          <Field label="Workshop">
            <input
              className={inputCls}
              value={f.workshop}
              onChange={set("workshop")}
            />
          </Field>
          <Field label="Next service date">
            <input
              type="date"
              className={inputCls}
              value={f.nextServiceDate}
              onChange={set("nextServiceDate")}
            />
          </Field>
          <Field label="Next service at (km)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={f.nextServiceOdometer}
              onChange={set("nextServiceOdometer")}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            rows={2}
            className={inputCls}
            value={f.description}
            onChange={set("description")}
          />
        </Field>
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

function Move({ rec, action, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    cost: rec.cost ?? "",
    odometer: rec.odometer ?? "",
    serviceDate: d(new Date().toISOString()),
    notes: "",
  });
  const [error, setError] = useState("");
  const [warn, setWarn] = useState(null);
  const m = useMutation({
    mutationFn: () =>
      post(`/maintenance/${rec._id}/transition`, {
        to: action.to,
        ...(action.to === "completed"
          ? {
              cost: f.cost,
              odometer: f.odometer || undefined,
              serviceDate: f.serviceDate,
            }
          : {}),
        notes: f.notes || undefined,
      }),
    onSuccess: (r) => {
      ["maintenance", "vehicles", "dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: `${rec.number}: ${action.label}`, variant: "success" });
      if (r.affectedTrips?.length) setWarn(r.affectedTrips);
      else onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  if (warn)
    return (
      <Modal title="Vehicle is now in the workshop" onClose={onClose}>
        <div className="flex gap-2 text-sm font-semibold mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-orange-600" />{" "}
          These upcoming trips use this vehicle. Replace the vehicle on each
          from the Trips page.
        </div>
        <ul className="border-2 border-black divide-y divide-black/10 text-sm">
          {warn.map((t) => (
            <li key={t.tripNumber} className="px-3 py-2">
              {t.tripNumber} · {t.scheduledDate}
            </li>
          ))}
        </ul>
        <div className="flex justify-end mt-4">
          <PrimaryButton onClick={onClose}>Understood</PrimaryButton>
        </div>
      </Modal>
    );
  return (
    <Modal title={`${action.label} · ${rec.number}`} onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      {action.to === "completed" ? (
        <div className="space-y-3">
          <Field label="Final cost (₹)" required>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value })}
            />
          </Field>
          <Field label="Odometer (km)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={f.odometer}
              onChange={(e) => setF({ ...f, odometer: e.target.value })}
            />
          </Field>
          <Field label="Service date">
            <input
              type="date"
              className={inputCls}
              value={f.serviceDate}
              onChange={(e) => setF({ ...f, serviceDate: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <p className="text-sm">
          {action.to === "in_progress"
            ? "The vehicle will be marked Under Maintenance and can't be assigned to new trips."
            : `Move this record to ${action.label}?`}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Back
        </button>
        <button
          disabled={m.isPending || (action.to === "completed" && f.cost === "")}
          onClick={() => m.mutate()}
          className={`border-2 border-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${action.danger ? "bg-[#EF4444]" : "bg-[#024BAB]"}`}
        >
          {action.label}
        </button>
      </div>
    </Modal>
  );
}

export default function MaintenancePage() {
  const { can } = useAuth();
  const canWrite = can("maintenance:write");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [form, setForm] = useState(false);
  const [move, setMove] = useState(null);
  const [files, setFiles] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["maintenance", page, status, type],
    queryFn: () => get("/maintenance", { page, limit: 15, status, type }),
  });
  const due = useQuery({
    queryKey: ["maintenance", "due"],
    queryFn: async () => (await get("/maintenance/due")).data,
  });
  const nDue =
    (due.data?.scheduled.length ?? 0) + (due.data?.services.length ?? 0);
  return (
    <AppLayout title="Maintenance">
      <PageHeader
        title="Maintenance"
        subtitle="Vehicles are out of service while work is in progress"
        actions={
          canWrite && (
            <PrimaryButton onClick={() => setForm(true)}>
              <Plus className="w-4 h-4" /> Report / schedule
            </PrimaryButton>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 mb-4 lg:grid-cols-3">
        <StatCard
          label="Service reminders"
          value={due.data ? nDue : "—"}
          icon={AlertTriangle}
          color="#FA731C"
        />
      </div>
      {due.data && nDue > 0 && (
        <div className="border-2 border-black bg-white mb-4">
          <div className="px-4 py-2 border-b-2 border-black bg-[#FA731C]/10 text-sm font-bold">
            Due soon
          </div>
          <ul className="divide-y divide-black/10 text-sm">
            {due.data.scheduled.map((m) => (
              <li key={m._id} className="px-4 py-2">
                {m.vehicle?.registrationNumber} · {m.issue} · scheduled{" "}
                {formatDateOrDash(m.scheduledDate)}
              </li>
            ))}
            {due.data.services.map((s) => (
              <li key={s.basedOn} className="px-4 py-2">
                {s.vehicle.registrationNumber} · next service{" "}
                {s.nextServiceDate ? formatDateOrDash(s.nextServiceDate) : ""}
                {s.nextServiceOdometer
                  ? ` / ${s.nextServiceOdometer} km`
                  : ""}{" "}
                {s.overdue && (
                  <span className="nb-badge nb-tag-red ml-1">Overdue</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterSelect
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          all="All Status"
          options={Object.entries(STATUS).map(([value, m]) => ({
            value,
            label: m.label,
          }))}
        />
        <FilterSelect
          value={type}
          onChange={(s) => {
            setType(s);
            setPage(1);
          }}
          all="All Types"
          options={TYPES.map(([value, label]) => ({ value, label }))}
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
            icon={Wrench}
            title="No maintenance records"
            message="Report an issue or schedule a service for a vehicle."
            action={
              canWrite ? (
                <PrimaryButton onClick={() => setForm(true)}>
                  Report / schedule
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Record",
            cell: (m) => <span className="font-bold">{m.number}</span>,
          },
          { header: "Vehicle", cell: (m) => m.vehicle?.registrationNumber },
          {
            header: "Issue",
            cell: (m) => (
              <div>
                <p>{m.issue}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {m.type.replace("_", " ")}
                </p>
              </div>
            ),
          },
          {
            header: "Priority",
            cell: (m) => (
              <span
                className={`nb-badge uppercase nb-tag-${PRIORITY[m.priority] === "gray" ? "white" : PRIORITY[m.priority]}`}
              >
                {m.priority}
              </span>
            ),
          },
          {
            header: "Scheduled",
            cell: (m) => formatDateOrDash(m.scheduledDate),
          },
          {
            header: "Cost",
            cell: (m) => (m.cost != null ? formatCurrency(m.cost) : "—"),
          },
          {
            header: "Status",
            cell: (m) => <StatusBadge meta={STATUS[m.status]} />,
          },
          {
            header: "Files",
            cell: (m) => <AttachButton onClick={() => setFiles(m)} />,
          },
          {
            header: "Files",
            cell: (m) => <AttachButton onClick={() => setFiles(m)} />,
          },
          ...(canWrite
            ? [
                {
                  header: "Actions",
                  cell: (m) => (
                    <div className="flex flex-wrap gap-1">
                      {(NEXT[m.status] ?? []).map((a) => (
                        <button
                          key={a.to}
                          onClick={() => setMove({ rec: m, action: a })}
                          className={`border-2 border-black px-2 py-1 text-xs font-bold ${a.danger ? "text-red-600" : ""}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
      {form && <MaintForm onClose={() => setForm(false)} />}
      {files && (
        <Attachments
          ownerType="maintenance"
          owner={files._id}
          docType="invoice"
          title={`Files · ${files.number}`}
          canWrite={canWrite}
          onClose={() => setFiles(null)}
        />
      )}
      {move && (
        <Move
          rec={move.rec}
          action={move.action}
          onClose={() => setMove(null)}
        />
      )}
    </AppLayout>
  );
}
