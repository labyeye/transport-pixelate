import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  List,
  Pencil,
  Plus,
  Repeat,
  Shuffle,
  Navigation,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common/PageHeader";
import { FilterSelect } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { StatusBadge, TRIP_STATUS } from "@/components/common/StatusBadge";
import { EventTimeline, Manifest } from "@/components/common/TripLive";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, patch, post, put, del } from "@/services/api";
import { errMsg } from "@/lib/errors";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPES = ["morning", "afternoon", "outbound", "return", "custom"];
const today = () => new Date().toLocaleDateString("en-CA");
const addDays = (ymd, n) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const mins = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
const hhmm = (iso) => fmtTime(iso);

// Next legal actions per status; server enforces the same state machine.
const ACTIONS = {
  scheduled: [{ to: "cancelled", label: "Cancel", reason: true, danger: true }],
  assigned: [
    { to: "ready", label: "Mark ready" },
    { to: "cancelled", label: "Cancel", reason: true, danger: true },
  ],
  ready: [
    { to: "in_progress", label: "Dispatch" },
    { to: "cancelled", label: "Cancel", reason: true, danger: true },
  ],
  in_progress: [
    { to: "delayed", label: "Delayed", reason: true },
    { to: "completed", label: "Complete" },
    { to: "aborted", label: "Abort", reason: true, danger: true },
  ],
  delayed: [
    { to: "in_progress", label: "Resume" },
    { to: "completed", label: "Complete" },
    { to: "aborted", label: "Abort", reason: true, danger: true },
  ],
};

function useLookups() {
  const routes = useQuery({
    queryKey: ["routes", "pick"],
    queryFn: async () => (await get("/routes", { limit: 100 })).data,
  });
  const vehicles = useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });
  const drivers = useQuery({
    queryKey: ["drivers", "pick"],
    queryFn: async () => (await get("/drivers", { limit: 100 })).data,
  });
  return {
    routes: routes.data ?? [],
    vehicles: vehicles.data ?? [],
    drivers: drivers.data ?? [],
  };
}

function Select({ value, onChange, children, label }) {
  return (
    <select
      aria-label={label}
      className={inputCls}
      value={value}
      onChange={onChange}
    >
      {children}
    </select>
  );
}

function TripForm({ trip, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { routes, vehicles, drivers } = useLookups();
  const [f, setF] = useState({
    route: trip?.route ?? "",
    tripType: trip?.tripType ?? "morning",
    scheduledDate: trip?.scheduledDate ?? today(),
    departureTime: trip ? hhmm(trip.scheduledDeparture) : "07:00",
    durationMin: trip
      ? mins(trip.scheduledDeparture, trip.expectedArrival)
      : 60,
    vehicle: trip?.vehicle?._id ?? "",
    driver: trip?.driver?._id ?? "",
    attendant: trip?.attendant?._id ?? "",
    notes: trip?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        vehicle: f.vehicle || null,
        driver: f.driver || null,
        attendant: f.attendant || null,
        notes: f.notes || undefined,
      };
      if (trip) delete body.route;
      return trip ? put(`/trips/${trip._id}`, body) : post("/trips", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: trip ? "Trip updated" : "Trip created",
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  const staff = drivers.filter((d) => d.staffRole === "driver");
  const attendants = drivers.filter((d) => d.staffRole === "attendant");
  return (
    <Modal
      title={trip ? `Edit ${trip.tripNumber}` : "New trip"}
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
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Route" required>
            <Select label="Route" value={f.route} onChange={set("route")}>
              {trip ? (
                <option value={f.route}>
                  {trip.routeSnapshot?.code} · {trip.routeSnapshot?.name}
                </option>
              ) : (
                <>
                  <option value="">Select route…</option>
                  {routes.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </>
              )}
            </Select>
          </Field>
          <Field label="Type">
            <Select label="Type" value={f.tripType} onChange={set("tripType")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <input
              required
              type="date"
              className={inputCls}
              value={f.scheduledDate}
              onChange={set("scheduledDate")}
            />
          </Field>
          <Field label="Departure" required>
            <input
              required
              type="time"
              className={inputCls}
              value={f.departureTime}
              onChange={set("departureTime")}
            />
          </Field>
          <Field label="Duration (min)" required>
            <input
              required
              type="number"
              min={1}
              className={inputCls}
              value={f.durationMin}
              onChange={set("durationMin")}
            />
          </Field>
          <Field label="Notes">
            <input
              className={inputCls}
              value={f.notes}
              onChange={set("notes")}
            />
          </Field>
          <Field label="Vehicle">
            <Select label="Vehicle" value={f.vehicle} onChange={set("vehicle")}>
              <option value="">— Unassigned —</option>
              {vehicles.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.registrationNumber} ({v.status.replace("_", " ")})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Driver">
            <Select label="Driver" value={f.driver} onChange={set("driver")}>
              <option value="">— Unassigned —</option>
              {staff.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} ({d.status.replace("_", " ")})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Attendant">
            <Select
              label="Attendant"
              value={f.attendant}
              onChange={set("attendant")}
            >
              <option value="">— None —</option>
              {attendants.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground font-medium">
          Times are in your organization's timezone. A trip with both vehicle
          and driver becomes “Assigned”. Overlapping assignments are rejected.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save trip"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ReasonDialog({ trip, action, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [km, setKm] = useState("");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: () =>
      post(`/trips/${trip._id}/transition`, {
        to: action.to,
        reason: reason || undefined,
        actualDistanceKm: km || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast({
        title: `${trip.tripNumber}: ${action.label}`,
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title={`${action.label} · ${trip.tripNumber}`} onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      {action.reason && (
        <Field label="Reason" required>
          <textarea
            className={inputCls}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
      {action.to === "completed" && (
        <Field label="Actual distance (km, optional)">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={km}
            onChange={(e) => setKm(e.target.value)}
          />
        </Field>
      )}
      {!action.reason && action.to !== "completed" && (
        <p className="text-sm">
          Move this trip to <b>{action.label}</b>?
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
          disabled={m.isPending || (action.reason && !reason.trim())}
          onClick={() => m.mutate()}
          className={`border-2 border-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${action.danger ? "bg-[#EF4444]" : "bg-[#024BAB]"}`}
        >
          {action.label}
        </button>
      </div>
    </Modal>
  );
}

function ReplaceDialog({ trip, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { vehicles, drivers } = useLookups();
  const [f, setF] = useState({ vehicle: "", driver: "", reason: "" });
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: () =>
      post(`/trips/${trip._id}/replace`, {
        vehicle: f.vehicle || undefined,
        driver: f.driver || undefined,
        reason: f.reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast({ title: "Assignment replaced", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title={`Replace · ${trip.tripNumber}`} onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <div className="space-y-3">
        <Field
          label={`New vehicle (now ${trip.vehicle?.registrationNumber ?? "none"})`}
        >
          <Select
            label="New vehicle"
            value={f.vehicle}
            onChange={(e) => setF({ ...f, vehicle: e.target.value })}
          >
            <option value="">Keep current</option>
            {vehicles.map((v) => (
              <option key={v._id} value={v._id}>
                {v.registrationNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`New driver (now ${trip.driver?.name ?? "none"})`}>
          <Select
            label="New driver"
            value={f.driver}
            onChange={(e) => setF({ ...f, driver: e.target.value })}
          >
            <option value="">Keep current</option>
            {drivers
              .filter((d) => d.staffRole === "driver")
              .map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Reason" required>
          <input
            className={inputCls}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Back
        </button>
        <PrimaryButton
          disabled={
            m.isPending ||
            f.reason.trim().length < 3 ||
            (!f.vehicle && !f.driver)
          }
          onClick={() => m.mutate()}
        >
          Replace
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function TripDetail({ id, onClose }) {
  const [tab, setTab] = useState("overview");
  const { data } = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => (await get(`/trips/${id}`)).data,
  });
  return (
    <Modal
      title={data ? `${data.tripNumber} · ${data.routeSnapshot.code}` : "Trip"}
      onClose={onClose}
      wide
    >
      {!data ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <StatusBadge meta={TRIP_STATUS[data.status]} />
            <span className="font-semibold">
              {data.scheduledDate} · {fmtTime(data.scheduledDeparture)}–
              {fmtTime(data.expectedArrival)}
            </span>
          </div>
          <p>
            Vehicle: <b>{data.vehicle?.registrationNumber ?? "—"}</b> · Driver:{" "}
            <b>{data.driver?.name ?? "—"}</b> · Attendant:{" "}
            <b>{data.attendant?.name ?? "—"}</b>
          </p>
          <div className="flex gap-2">
            {[
              ["overview", "Overview"],
              ["manifest", "Manifest"],
              ["events", "Events"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`border-2 border-black px-3 py-1 text-xs font-bold ${tab === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {tab === "manifest" && <Manifest trip={data} />}
          {tab === "events" && <EventTimeline trip={data} />}
          {tab === "overview" && (
            <>
              {data.delayReason && <p>Delay reason: {data.delayReason}</p>}
              {data.cancellationReason && (
                <p>Cancel/abort reason: {data.cancellationReason}</p>
              )}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1">
                  Planned stops (route v{data.routeSnapshot.version} snapshot)
                </p>
                <ol className="border-2 border-black bg-white divide-y divide-black/10">
                  {data.routeSnapshot.stops.map((s) => (
                    <li
                      key={s.sequence}
                      className="px-3 py-2 flex justify-between"
                    >
                      <span>
                        {s.sequence}. {s.name}
                      </span>
                      <span className="text-muted-foreground">
                        {s.plannedArrival ?? ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1">
                  History
                </p>
                <ul className="border-2 border-black bg-white divide-y divide-black/10">
                  {data.history.map((h, i) => (
                    <li key={i} className="px-3 py-2">
                      <b className="capitalize">{h.action}</b>
                      {h.to ? ` → ${h.to.replace("_", " ")}` : ""}{" "}
                      <span className="text-muted-foreground">
                        · {new Date(h.at).toLocaleString("en-IN")}
                        {h.by?.name ? ` · ${h.by.name}` : ""}
                      </span>
                      {h.note ? (
                        <p className="text-muted-foreground">{h.note}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function WeekView({ start, trips, onOpen }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {days.map((d) => {
        const list = trips.filter((t) => t.scheduledDate === d);
        return (
          <div key={d} className="border-2 border-black bg-white min-h-32">
            <div className="px-2 py-1.5 border-b-2 border-black bg-[#024BAB]/5 text-xs font-bold">
              {DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} {d.slice(5)}
            </div>
            <div className="p-1.5 space-y-1">
              {list.length === 0 && (
                <p className="text-xs text-muted-foreground">No trips</p>
              )}
              {list.map((t) => (
                <button
                  key={t._id}
                  onClick={() => onOpen(t._id)}
                  className="w-full text-left border-2 border-black p-1.5 text-xs hover:bg-[#024BAB]/10"
                >
                  <p className="font-bold">
                    {fmtTime(t.scheduledDeparture)} · {t.routeSnapshot.code}
                  </p>
                  <p className="text-muted-foreground truncate">
                    {t.vehicle?.registrationNumber ?? "No vehicle"}
                  </p>
                  <StatusBadge meta={TRIP_STATUS[t.status]} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleForm({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { routes, vehicles, drivers } = useLookups();
  const [f, setF] = useState({
    name: "",
    route: "",
    tripType: "morning",
    daysOfWeek: [1, 2, 3, 4, 5],
    startDate: today(),
    endDate: "",
    departureTime: "07:00",
    durationMin: 60,
    vehicle: "",
    driver: "",
    attendant: "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      post("/trip-schedules", {
        ...f,
        endDate: f.endDate || undefined,
        vehicle: f.vehicle || null,
        driver: f.driver || null,
        attendant: f.attendant || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      toast({ title: "Schedule created", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="New recurring schedule" onClose={onClose} wide>
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
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Name" required>
            <input
              required
              className={inputCls}
              value={f.name}
              onChange={set("name")}
            />
          </Field>
          <Field label="Route" required>
            <Select label="Route" value={f.route} onChange={set("route")}>
              <option value="">Select route…</option>
              {routes.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.code} · {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select label="Type" value={f.tripType} onChange={set("tripType")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts" required>
            <input
              required
              type="date"
              className={inputCls}
              value={f.startDate}
              onChange={set("startDate")}
            />
          </Field>
          <Field label="Ends (optional)">
            <input
              type="date"
              className={inputCls}
              value={f.endDate}
              onChange={set("endDate")}
            />
          </Field>
          <Field label="Departure" required>
            <input
              required
              type="time"
              className={inputCls}
              value={f.departureTime}
              onChange={set("departureTime")}
            />
          </Field>
          <Field label="Duration (min)" required>
            <input
              required
              type="number"
              min={1}
              className={inputCls}
              value={f.durationMin}
              onChange={set("durationMin")}
            />
          </Field>
          <Field label="Vehicle">
            <Select label="Vehicle" value={f.vehicle} onChange={set("vehicle")}>
              <option value="">— None —</option>
              {vehicles.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.registrationNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Driver">
            <Select label="Driver" value={f.driver} onChange={set("driver")}>
              <option value="">— None —</option>
              {drivers
                .filter((d) => d.staffRole === "driver")
                .map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = f.daysOfWeek.includes(i);
            return (
              <button
                type="button"
                key={d}
                aria-pressed={on}
                onClick={() =>
                  setF({
                    ...f,
                    daysOfWeek: on
                      ? f.daysOfWeek.filter((x) => x !== i)
                      : [...f.daysOfWeek, i].sort(),
                  })
                }
                className={`border-2 border-black px-3 py-1 text-xs font-bold ${on ? "bg-[#024BAB] text-white" : "bg-white"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending || !f.daysOfWeek.length}>
            Save schedule
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function Schedules({ canWrite }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(false);
  const [gen, setGen] = useState(null);
  const [range, setRange] = useState({
    from: today(),
    to: addDays(today(), 13),
  });
  const [result, setResult] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: async () => (await get("/trip-schedules")).data,
  });
  const genMut = useMutation({
    mutationFn: () => post(`/trip-schedules/${gen._id}/generate`, range),
    onSuccess: (r) => {
      setResult(r.data);
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
    onError: (e) =>
      toast({
        title: "Could not generate",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const toggle = useMutation({
    mutationFn: (s) =>
      patch(`/trip-schedules/${s._id}/active`, { active: !s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });
  const remove = useMutation({
    mutationFn: (s) => del(`/trip-schedules/${s._id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        {canWrite && (
          <PrimaryButton onClick={() => setForm(true)}>
            <Plus className="w-4 h-4" /> New schedule
          </PrimaryButton>
        )}
      </div>
      <DataTable
        loading={isLoading}
        rows={data ?? []}
        onPage={() => {}}
        empty={
          <EmptyState
            icon={Repeat}
            title="No recurring schedules"
            message="Create a schedule, then generate trips for a date range."
          />
        }
        columns={[
          {
            header: "Name",
            cell: (s) => <span className="font-bold">{s.name}</span>,
          },
          { header: "Route", cell: (s) => s.route?.code },
          {
            header: "Days",
            cell: (s) => s.daysOfWeek.map((d) => DAYS[d]).join(", "),
          },
          {
            header: "Departure",
            cell: (s) => `${s.departureTime} · ${s.durationMin} min`,
          },
          {
            header: "Vehicle / Driver",
            cell: (s) =>
              `${s.vehicle?.registrationNumber ?? "—"} / ${s.driver?.name ?? "—"}`,
          },
          {
            header: "Status",
            cell: (s) => (
              <span
                className={`nb-badge uppercase ${s.active ? "nb-tag-green" : "nb-tag-white"}`}
              >
                {s.active ? "Active" : "Paused"}
              </span>
            ),
          },
          ...(canWrite
            ? [
                {
                  header: "Actions",
                  cell: (s) => (
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setGen(s);
                          setResult(null);
                        }}
                        disabled={!s.active}
                        className="border-2 border-black px-2 py-1 text-xs font-bold disabled:opacity-40"
                      >
                        Generate
                      </button>
                      <button
                        onClick={() => toggle.mutate(s)}
                        className="border-2 border-black px-2 py-1 text-xs font-bold"
                      >
                        {s.active ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => remove.mutate(s)}
                        className="border-2 border-black px-2 py-1 text-xs font-bold text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
      {form && <ScheduleForm onClose={() => setForm(false)} />}
      {gen && (
        <Modal
          title={`Generate trips · ${gen.name}`}
          onClose={() => setGen(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input
                type="date"
                className={inputCls}
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </Field>
            <Field label="To (max 62 days)">
              <input
                type="date"
                className={inputCls}
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground font-medium mt-2">
            Already generated dates are skipped. Days with resource conflicts
            are created unassigned.
          </p>
          {result && (
            <div className="mt-3 border-2 border-black p-3 text-sm space-y-1">
              <p className="font-bold">
                {result.created.length} created, {result.skipped.length} skipped
              </p>
              {result.skipped.map((s, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {s.date}: {s.reason}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setGen(null)}
              className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
            >
              Close
            </button>
            <PrimaryButton
              disabled={genMut.isPending}
              onClick={() => genMut.mutate()}
            >
              Generate
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function TripsPage() {
  const { can } = useAuth();
  const canWrite = can("trips:write");
  const canDispatch = can("trips:dispatch");
  const [tab, setTab] = useState("trips");
  const [view, setView] = useState("table");
  const [page, setPage] = useState(1);
  const [date, setDate] = useState(today());
  const [weekStart, setWeekStart] = useState(
    addDays(today(), -new Date().getDay()),
  );
  const [status, setStatus] = useState("");
  const [route, setRoute] = useState("");
  const [form, setForm] = useState(null);
  const [action, setAction] = useState(null);
  const [replace, setReplace] = useState(null);
  const [detail, setDetail] = useState(null);
  const { routes } = useLookups();

  const query =
    view === "week"
      ? {
          from: weekStart,
          to: addDays(weekStart, 6),
          limit: 100,
          status,
          route,
        }
      : { date: date || undefined, page, limit: 15, status, route };
  const { data, isLoading, error } = useQuery({
    queryKey: ["trips", view, query],
    queryFn: () => get("/trips", query),
    enabled: tab === "trips",
  });
  const filtered = !!(status || route);

  return (
    <AppLayout title="Trips">
      <PageHeader
        title="Trips & dispatch"
        subtitle="Schedule, assign and dispatch trips"
        actions={
          canWrite &&
          tab === "trips" && (
            <PrimaryButton onClick={() => setForm("new")}>
              <CalendarPlus className="w-4 h-4" /> New trip
            </PrimaryButton>
          )
        }
      />
      <div className="flex gap-2 mb-4">
        {[
          ["trips", "Trips"],
          ["schedules", "Recurring schedules"],
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
      {tab === "schedules" ? (
        <Schedules canWrite={canWrite} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <div className="flex">
              <button
                aria-label="Table view"
                onClick={() => setView("table")}
                className={`no-nb border-2 border-black p-2 ${view === "table" ? "bg-[#024BAB] text-white" : "bg-white"}`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                aria-label="Week view"
                onClick={() => setView("week")}
                className={`no-nb border-2 border-l-0 border-black p-2 ${view === "week" ? "bg-[#024BAB] text-white" : "bg-white"}`}
              >
                <CalendarDays className="w-4 h-4" />
              </button>
            </div>
            {view === "table" ? (
              <input
                type="date"
                aria-label="Date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPage(1);
                }}
                className="border-2 border-black bg-white px-3 py-2 text-sm font-semibold"
              />
            ) : (
              <div className="flex items-center gap-1">
                <button
                  aria-label="Previous week"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  className="border-2 border-black bg-white p-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold px-2">
                  {weekStart} → {addDays(weekStart, 6)}
                </span>
                <button
                  aria-label="Next week"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                  className="border-2 border-black bg-white p-2"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            <FilterSelect
              value={status}
              onChange={(s) => {
                setStatus(s);
                setPage(1);
              }}
              all="All Status"
              options={Object.entries(TRIP_STATUS).map(([value, m]) => ({
                value,
                label: m.label,
              }))}
            />
            <FilterSelect
              value={route}
              onChange={(s) => {
                setRoute(s);
                setPage(1);
              }}
              all="All Routes"
              options={routes.map((r) => ({
                value: r._id,
                label: `${r.code} · ${r.name}`,
              }))}
            />
            {view === "table" && date && (
              <button
                onClick={() => setDate("")}
                className="text-xs font-bold underline"
              >
                All dates
              </button>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700 mb-3"
            >
              {errMsg(error)}
            </div>
          )}
          {view === "week" ? (
            isLoading ? (
              <div className="h-40 border-2 border-black bg-white animate-pulse" />
            ) : (
              <WeekView
                start={weekStart}
                trips={data?.data ?? []}
                onOpen={setDetail}
              />
            )
          ) : (
            <DataTable
              loading={isLoading}
              rows={data?.data ?? []}
              meta={data?.meta}
              onPage={setPage}
              empty={
                <EmptyState
                  icon={Navigation}
                  title={
                    filtered || date
                      ? "No trips for this selection"
                      : "No trips yet"
                  }
                  message="Create a trip, or generate trips from a recurring schedule."
                  action={
                    canWrite ? (
                      <PrimaryButton onClick={() => setForm("new")}>
                        New trip
                      </PrimaryButton>
                    ) : undefined
                  }
                />
              }
              columns={[
                {
                  header: "Trip",
                  cell: (t) => (
                    <button
                      onClick={() => setDetail(t._id)}
                      className="font-bold underline"
                    >
                      {t.tripNumber}
                    </button>
                  ),
                  className: "whitespace-nowrap",
                },
                {
                  header: "Route",
                  cell: (t) => `${t.routeSnapshot.code} · ${t.tripType}`,
                },
                {
                  header: "When",
                  cell: (t) =>
                    `${t.scheduledDate} ${fmtTime(t.scheduledDeparture)}–${fmtTime(t.expectedArrival)}`,
                },
                {
                  header: "Vehicle",
                  cell: (t) =>
                    t.vehicle?.registrationNumber ?? (
                      <span className="text-muted-foreground">Unassigned</span>
                    ),
                },
                {
                  header: "Driver",
                  cell: (t) =>
                    t.driver?.name ?? (
                      <span className="text-muted-foreground">Unassigned</span>
                    ),
                },
                {
                  header: "Status",
                  cell: (t) => <StatusBadge meta={TRIP_STATUS[t.status]} />,
                },
                {
                  header: "Actions",
                  cell: (t) => (
                    <div className="flex flex-wrap gap-1">
                      {canWrite &&
                        ["draft", "scheduled", "assigned", "ready"].includes(
                          t.status,
                        ) && (
                          <button
                            aria-label="Edit"
                            title="Edit / reschedule"
                            onClick={() => setForm(t)}
                            className="border-2 border-black p-1.5"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      {canDispatch &&
                        [
                          "scheduled",
                          "assigned",
                          "ready",
                          "in_progress",
                          "delayed",
                        ].includes(t.status) && (
                          <button
                            aria-label="Replace"
                            title="Replace vehicle/driver"
                            onClick={() => setReplace(t)}
                            className="border-2 border-black p-1.5"
                          >
                            <Shuffle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      {canDispatch &&
                        (ACTIONS[t.status] ?? []).map((a) => (
                          <button
                            key={a.to}
                            onClick={() => setAction({ trip: t, action: a })}
                            className={`border-2 border-black px-2 py-1 text-xs font-bold ${a.danger ? "text-red-600" : ""}`}
                          >
                            {a.label}
                          </button>
                        ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
      {form && (
        <TripForm
          trip={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {action && (
        <ReasonDialog
          trip={action.trip}
          action={action.action}
          onClose={() => setAction(null)}
        />
      )}
      {replace && (
        <ReplaceDialog trip={replace} onClose={() => setReplace(null)} />
      )}
      {detail && <TripDetail id={detail} onClose={() => setDetail(null)} />}
    </AppLayout>
  );
}
