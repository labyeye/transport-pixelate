import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { AttachButton, Attachments } from "@/components/common/Attachments";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, post } from "@/services/api";
import { errMsg } from "@/lib/errors";

const STATUS = {
  submitted: { label: "Submitted", tone: "blue" },
  under_review: { label: "Under review", tone: "purple" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  in_progress: { label: "In progress", tone: "orange" },
  resolved: { label: "Resolved", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};
const PRIORITY = {
  low: "nb-tag-white",
  normal: "nb-tag-blue",
  high: "nb-tag-orange",
  urgent: "nb-tag-red",
};
const OPEN = ["submitted", "under_review"];

// Field kinds: trip | route | vehicle | driver | passenger (pickers), text, number, date, time, check.
const TYPES = {
  trip_cancellation: {
    label: "Cancel a trip",
    fields: [
      ["trip", "trip", "Trip"],
      ["reason", "text", "Reason for cancelling"],
    ],
  },
  vehicle_replacement: {
    label: "Replace a vehicle",
    fields: [
      ["trip", "trip", "Trip"],
      ["vehicle", "vehicle", "New vehicle"],
    ],
  },
  driver_replacement: {
    label: "Replace a driver",
    fields: [
      ["trip", "trip", "Trip"],
      ["driver", "driver", "New driver"],
    ],
  },
  additional_trip: {
    label: "Additional trip",
    fields: [
      ["route", "route", "Route"],
      ["scheduledDate", "date", "Date"],
      ["departureTime", "time", "Departure"],
      ["durationMin", "number", "Duration (min)"],
      ["vehicle", "vehicle", "Vehicle (optional)", true],
      ["driver", "driver", "Driver (optional)", true],
    ],
  },
  schedule_change: {
    label: "Change a trip's schedule",
    fields: [
      ["trip", "trip", "Trip"],
      ["scheduledDate", "date", "New date"],
      ["departureTime", "time", "New departure"],
    ],
  },
  passenger_assignment: {
    label: "Passenger route / stop change",
    fields: [
      ["passenger", "passenger", "Passenger"],
      ["route", "route", "Route"],
      ["remove", "check", "Remove from this route"],
      ["pickupStop", "stop", "Pickup stop"],
      ["dropStop", "stop", "Drop stop"],
    ],
  },
  new_stop: {
    label: "New pickup / drop stop",
    fields: [
      ["route", "route", "Route"],
      ["name", "text", "Stop name"],
      ["lat", "number", "Latitude"],
      ["lng", "number", "Longitude"],
      [
        "afterSequence",
        "number",
        "Insert after stop no. (blank = at end)",
        true,
      ],
    ],
  },
  new_route: {
    label: "New route",
    fields: [
      ["name", "text", "Route name"],
      ["code", "text", "Code"],
      ["stops", "stops", "Stops (name, lat, lng — one per line)"],
    ],
  },
  special_requirement: { label: "Special requirement", fields: [] },
};

const usePick = (key, path, params) =>
  useQuery({
    queryKey: [key, "pick"],
    queryFn: async () => (await get(path, params)).data,
  });

function useLookups() {
  const today = new Date().toLocaleDateString("en-CA");
  const trips = usePick("trips", "/trips", { limit: 100, from: today });
  const routes = usePick("routes", "/routes", { limit: 100 });
  const vehicles = usePick("vehicles", "/vehicles", { limit: 100 });
  const drivers = usePick("drivers", "/drivers", { limit: 100 });
  const passengers = usePick("passengers", "/passengers", { limit: 100 });
  return {
    trips: trips.data ?? [],
    routes: routes.data ?? [],
    vehicles: vehicles.data ?? [],
    drivers: (drivers.data ?? []).filter((d) => d.staffRole === "driver"),
    passengers: passengers.data ?? [],
  };
}

function RequestForm({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const L = useLookups();
  const [type, setType] = useState("trip_cancellation");
  const [v, setV] = useState({});
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState("");
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const cfg = TYPES[type];
  const route = L.routes.find((r) => r._id === v.route);
  const stops = route?.stops.filter((s) => s.active).map((s) => s.name) ?? [];

  const build = () => {
    const p = {};
    for (const [k, kind, , optional] of cfg.fields) {
      let val = v[k];
      if (kind === "check") {
        if (val) p[k] = true;
        continue;
      }
      if (val === undefined || val === "") {
        if (!optional) continue;
        else continue;
      }
      if (kind === "number") val = Number(val);
      if (kind === "stops")
        val = String(val)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [name, lat, lng] = l.split(",").map((x) => x.trim());
            return { name, lat: Number(lat), lng: Number(lng) };
          });
      p[k] = val;
    }
    if (type === "passenger_assignment" && p.remove) {
      delete p.pickupStop;
      delete p.dropStop;
    }
    return p;
  };
  const save = useMutation({
    mutationFn: () =>
      post("/requests", { type, description, priority, payload: build() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Request submitted", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  const picker = (kind) =>
    ({
      trip: L.trips.map((t) => [
        t._id,
        `${t.tripNumber} · ${t.scheduledDate} · ${t.routeSnapshot.code}`,
      ]),
      route: L.routes.map((r) => [r._id, `${r.code} · ${r.name}`]),
      vehicle: L.vehicles.map((x) => [x._id, x.registrationNumber]),
      driver: L.drivers.map((x) => [x._id, x.name]),
      passenger: L.passengers.map((x) => [x._id, x.name]),
      stop: stops.map((s) => [s, s]),
    })[kind];

  return (
    <Modal title="New transport request" onClose={onClose} wide>
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
          <Field label="Request type">
            <select
              className={inputCls}
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setV({});
              }}
            >
              {Object.entries(TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className={inputCls}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {Object.keys(PRIORITY).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          {cfg.fields.map(([k, kind, label, optional]) => {
            if (
              type === "passenger_assignment" &&
              v.remove &&
              (k === "pickupStop" || k === "dropStop")
            )
              return null;
            if (kind === "check")
              return (
                <label
                  key={k}
                  className="flex items-center gap-2 text-sm font-semibold self-end pb-2"
                >
                  <input
                    type="checkbox"
                    checked={!!v[k]}
                    onChange={(e) => set(k, e.target.checked)}
                  />{" "}
                  {label}
                </label>
              );
            if (kind === "stops")
              return (
                <div key={k} className="sm:col-span-2">
                  <Field label={label} required>
                    <textarea
                      rows={4}
                      className={inputCls}
                      placeholder={"Gate 1, 19.07, 72.87\nMarket, 19.08, 72.88"}
                      value={v[k] ?? ""}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  </Field>
                </div>
              );
            const opts = picker(kind);
            return (
              <Field key={k} label={label} required={!optional}>
                {opts ? (
                  <select
                    required={!optional}
                    className={inputCls}
                    value={v[k] ?? ""}
                    onChange={(e) => set(k, e.target.value)}
                  >
                    <option value="">
                      {optional ? "— None —" : "Select…"}
                    </option>
                    {opts.map(([val, text]) => (
                      <option key={val} value={val}>
                        {text}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={!optional}
                    type={
                      kind === "date"
                        ? "date"
                        : kind === "time"
                          ? "time"
                          : kind === "number"
                            ? "number"
                            : "text"
                    }
                    step="any"
                    className={inputCls}
                    value={v[k] ?? ""}
                    onChange={(e) => set(k, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
        <Field label="Details" required>
          <textarea
            required
            minLength={5}
            rows={3}
            className={inputCls}
            placeholder="Explain what you need and why"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted-foreground font-medium">
          A reviewer checks the effect on schedules and assignments before
          anything changes. You can attach files after submitting.
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
            {save.isPending ? "Submitting…" : "Submit request"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function Detail({ id, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, can } = useAuth();
  const reviewer = can("requests:review");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState(false);
  const [error, setError] = useState("");
  const { data: r } = useQuery({
    queryKey: ["request", id],
    queryFn: async () => (await get(`/requests/${id}`)).data,
  });
  const preview = useQuery({
    queryKey: ["request-preview", id, r?.status, r?.updatedAt],
    queryFn: async () => (await get(`/requests/${id}/preview`)).data,
    enabled: !!r && reviewer && OPEN.includes(r.status),
  });
  const refresh = () =>
    [
      "request",
      "requests",
      "dashboard",
      "trips",
      "routes",
      "request-preview",
    ].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({
    mutationFn: ({ path, body }) => post(`/requests/${id}/${path}`, body),
    onSuccess: () => {
      refresh();
      setError("");
      setNote("");
      toast({ title: "Updated", variant: "success" });
    },
    onError: (e) => {
      setError(
        e.errors?.length ? `${errMsg(e)}: ${e.errors.join("; ")}` : errMsg(e),
      );
      refresh();
    },
  });
  if (!r)
    return (
      <Modal title="Request" onClose={onClose}>
        <p className="text-sm">Loading…</p>
      </Modal>
    );
  const mine = r.requester?._id === user.id;
  const pv = preview.data;
  return (
    <Modal
      title={`${r.number} · ${TYPES[r.type]?.label}`}
      onClose={onClose}
      wide
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge meta={STATUS[r.status]} />
          <span className={`nb-badge uppercase ${PRIORITY[r.priority]}`}>
            {r.priority}
          </span>
          <span className="text-muted-foreground font-medium">
            by {r.requester?.name} ·{" "}
            {new Date(r.createdAt).toLocaleString("en-IN")}
          </span>
        </div>
        <p>{r.description}</p>
        {r.appliedChange && (
          <div className="border-2 border-black bg-green-50 p-3 font-semibold flex gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />{" "}
            {r.appliedChange}
          </div>
        )}
        {r.applyError && OPEN.includes(r.status) && (
          <div className="border-2 border-[#EF4444] bg-red-50 p-3 font-semibold text-red-700">
            Last attempt couldn't be applied: {r.applyError}
          </div>
        )}
        {r.resolutionNotes && (
          <p>
            <b>Notes:</b> {r.resolutionNotes}
          </p>
        )}
        {reviewer && OPEN.includes(r.status) && pv && (
          <div
            className={`border-2 p-3 ${pv.canApply ? "border-black bg-[#024BAB]/5" : "border-[#FA731C] bg-orange-50"}`}
          >
            <p className="font-bold flex items-center gap-1.5">
              {pv.canApply ? (
                <CheckCircle2 className="w-4 h-4 text-green-700" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-orange-600" />
              )}{" "}
              Impact check against current schedules
            </p>
            {pv.problems.map((p, i) => (
              <p key={i} className="text-red-700 font-semibold mt-1">
                • {p.message}
              </p>
            ))}
            {pv.canApply && (
              <ul className="mt-1 text-muted-foreground font-medium">
                {Object.entries(pv.impact).map(([k, val]) => (
                  <li key={k}>
                    {k.replace(/([A-Z])/g, " $1").toLowerCase()}:{" "}
                    <b className="text-black">{String(val)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1">
            History
          </p>
          <ul className="border-2 border-black bg-white divide-y divide-black/10">
            {r.history.map((h, i) => (
              <li key={i} className="px-3 py-2">
                <b className="capitalize">{h.to.replace("_", " ")}</b>{" "}
                <span className="text-muted-foreground">
                  · {new Date(h.at).toLocaleString("en-IN")}
                  {h.by?.name ? ` · ${h.by.name}` : ""}
                </span>
                {h.note && <p className="text-muted-foreground">{h.note}</p>}
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <div
            role="alert"
            className="border-2 border-[#EF4444] bg-red-50 p-2.5 font-semibold text-red-700"
          >
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <AttachButton label="Files" onClick={() => setFiles(true)} />
          {reviewer &&
            !mine &&
            ["submitted", "under_review", "approved", "in_progress"].includes(
              r.status,
            ) && (
              <input
                aria-label="Note"
                placeholder="Note (required to reject)"
                className={`${inputCls} flex-1 min-w-48`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          {reviewer && !mine && r.status === "submitted" && (
            <PrimaryButton
              disabled={act.isPending}
              onClick={() => act.mutate({ path: "start-review" })}
            >
              Start review
            </PrimaryButton>
          )}
          {reviewer && !mine && r.status === "under_review" && (
            <>
              <button
                disabled={act.isPending || !note.trim()}
                onClick={() =>
                  act.mutate({
                    path: "review",
                    body: { decision: "rejected", note },
                  })
                }
                className="border-2 border-black bg-[#EF4444] text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
              >
                Reject
              </button>
              <PrimaryButton
                disabled={act.isPending || (pv && !pv.canApply)}
                onClick={() =>
                  act.mutate({
                    path: "review",
                    body: { decision: "approved", note: note || undefined },
                  })
                }
              >
                Approve &amp; apply
              </PrimaryButton>
            </>
          )}
          {reviewer && r.status === "approved" && (
            <button
              onClick={() =>
                act.mutate({
                  path: "progress",
                  body: { to: "in_progress", note: note || undefined },
                })
              }
              className="border-2 border-black px-3 py-2 text-sm font-bold"
            >
              Start work
            </button>
          )}
          {reviewer && ["approved", "in_progress"].includes(r.status) && (
            <PrimaryButton
              onClick={() =>
                act.mutate({
                  path: "progress",
                  body: { to: "resolved", note: note || undefined },
                })
              }
            >
              Mark resolved
            </PrimaryButton>
          )}
          {OPEN.includes(r.status) && (mine || reviewer) && (
            <button
              disabled={act.isPending}
              onClick={() =>
                window.confirm("Cancel this request?") &&
                act.mutate({ path: "cancel" })
              }
              className="border-2 border-black bg-white px-3 py-2 text-sm font-bold text-red-600"
            >
              Cancel request
            </button>
          )}
        </div>
        {reviewer && mine && OPEN.includes(r.status) && (
          <p className="text-xs text-muted-foreground font-medium">
            You filed this request, so someone else must review it.
          </p>
        )}
      </div>
      {files && (
        <Attachments
          ownerType="request"
          owner={r._id}
          docType="attachment"
          title={`Files · ${r.number}`}
          canWrite={OPEN.includes(r.status) || reviewer}
          onClose={() => setFiles(false)}
        />
      )}
    </Modal>
  );
}

export default function RequestsPage() {
  const { can } = useAuth();
  const reviewer = can("requests:review");
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState(reviewer ? "review" : "mine");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);
  const query = {
    page,
    limit: 15,
    status,
    type,
    scope: scope === "all" ? undefined : scope,
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ["requests", query],
    queryFn: () => get("/requests", query),
  });
  return (
    <AppLayout title="Requests">
      <PageHeader
        title="Transport requests"
        subtitle="Ask for changes; reviewers check the impact before anything is applied"
        actions={
          <PrimaryButton onClick={() => setForm(true)}>
            <Plus className="w-4 h-4" /> New request
          </PrimaryButton>
        }
      />
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {[
          ...(reviewer ? [["review", "Needs review"]] : []),
          ["mine", "My requests"],
          ...(reviewer ? [["all", "All"]] : []),
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setScope(k);
              setPage(1);
            }}
            className={`border-2 border-black px-3 py-1.5 text-sm font-bold ${scope === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
          >
            {l}
          </button>
        ))}
        <FilterSelect
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          all="Any status"
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
          all="Any type"
          options={Object.entries(TYPES).map(([value, t]) => ({
            value,
            label: t.label,
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
            icon={ClipboardList}
            title="No requests here"
            message={
              scope === "review"
                ? "Nothing is waiting for review."
                : "File a request to ask for a route, trip or assignment change."
            }
            action={
              <PrimaryButton onClick={() => setForm(true)}>
                New request
              </PrimaryButton>
            }
          />
        }
        columns={[
          {
            header: "Request",
            cell: (r) => (
              <button
                onClick={() => setOpen(r._id)}
                className="font-bold underline"
              >
                {r.number}
              </button>
            ),
          },
          { header: "Type", cell: (r) => TYPES[r.type]?.label },
          { header: "By", cell: (r) => r.requester?.name },
          {
            header: "Priority",
            cell: (r) => (
              <span className={`nb-badge uppercase ${PRIORITY[r.priority]}`}>
                {r.priority}
              </span>
            ),
          },
          {
            header: "Filed",
            cell: (r) => new Date(r.createdAt).toLocaleDateString("en-IN"),
          },
          { header: "Reviewer", cell: (r) => r.reviewer?.name ?? "—" },
          {
            header: "Status",
            cell: (r) => <StatusBadge meta={STATUS[r.status]} />,
          },
        ]}
      />
      {form && <RequestForm onClose={() => setForm(false)} />}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </AppLayout>
  );
}
