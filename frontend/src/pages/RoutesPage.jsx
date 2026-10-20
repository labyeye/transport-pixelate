import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Copy,
  Pencil,
  Plus,
  Power,
  Route as RouteIcon,
  Trash2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { RouteMap } from "@/components/common/RouteMap";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, patch, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const blankStop = (lat = "", lng = "") => ({
  name: "",
  address: "",
  lat,
  lng,
  plannedArrival: "",
  plannedDeparture: "",
  dwellMinutes: 0,
  allowsPickup: true,
  allowsDropoff: true,
  active: true,
});

function RouteForm({ route, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    name: route?.name ?? "",
    code: route?.code ?? "",
    description: route?.description ?? "",
    category: route?.category ?? "regular",
    branch: route?.branch ?? "",
    plannedDistanceKm: route?.plannedDistanceKm ?? "",
    estimatedDurationMin: route?.estimatedDurationMin ?? "",
    startTime: route?.startTime ?? "",
    endTime: route?.endTime ?? "",
    operatingDays: route?.operatingDays ?? [1, 2, 3, 4, 5],
    assignedVehicle: route?.assignedVehicle?._id ?? "",
    assignedDriver: route?.assignedDriver?._id ?? "",
  });
  const [stops, setStops] = useState(
    (route?.stops ?? []).map((s) => ({
      name: s.name,
      address: s.address ?? "",
      lat: s.location.lat,
      lng: s.location.lng,
      plannedArrival: s.plannedArrival ?? "",
      plannedDeparture: s.plannedDeparture ?? "",
      dwellMinutes: s.dwellMinutes ?? 0,
      allowsPickup: s.allowsPickup,
      allowsDropoff: s.allowsDropoff,
      active: s.active,
    })),
  );
  const [error, setError] = useState("");
  const vehicles = useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });
  const drivers = useQuery({
    queryKey: ["drivers", "assignable"],
    queryFn: async () =>
      (await get("/drivers", { limit: 100, staffRole: "driver" })).data,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setStop = (i, k, v) =>
    setStops(stops.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const c = [...stops];
    [c[i], c[j]] = [c[j], c[i]];
    setStops(c);
  };

  const save = useMutation({
    mutationFn: () => {
      const clean = (v) => (v === "" ? undefined : v);
      const body = {
        name: f.name,
        code: f.code,
        description: clean(f.description),
        category: f.category || "regular",
        branch: clean(f.branch),
        plannedDistanceKm: clean(f.plannedDistanceKm),
        estimatedDurationMin: clean(f.estimatedDurationMin),
        startTime: clean(f.startTime),
        endTime: clean(f.endTime),
        operatingDays: f.operatingDays,
        assignedVehicle: f.assignedVehicle || null,
        assignedDriver: f.assignedDriver || null,
        stops: stops.map((s) => ({
          ...s,
          address: clean(s.address),
          plannedArrival: clean(s.plannedArrival),
          plannedDeparture: clean(s.plannedDeparture),
        })),
      };
      return route ? put(`/routes/${route._id}`, body) : post("/routes", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routes"] });
      toast({
        title: route ? "Route updated" : "Route created",
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <Modal
      title={route ? `Edit route · ${route.code}` : "New route"}
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
          <Field label="Route name" required>
            <input
              required
              className={inputCls}
              value={f.name}
              onChange={set("name")}
            />
          </Field>
          <Field label="Code" required>
            <input
              required
              className={inputCls}
              placeholder="R-01"
              value={f.code}
              onChange={set("code")}
            />
          </Field>
          <Field label="Category">
            <input
              className={inputCls}
              value={f.category}
              onChange={set("category")}
            />
          </Field>
          <Field label="Start time">
            <input
              type="time"
              className={inputCls}
              value={f.startTime}
              onChange={set("startTime")}
            />
          </Field>
          <Field label="End time">
            <input
              type="time"
              className={inputCls}
              value={f.endTime}
              onChange={set("endTime")}
            />
          </Field>
          <Field label="Branch">
            <input
              className={inputCls}
              value={f.branch}
              onChange={set("branch")}
            />
          </Field>
          <Field label="Distance (km, manual)">
            <input
              type="number"
              min={0}
              step="0.1"
              className={inputCls}
              value={f.plannedDistanceKm}
              onChange={set("plannedDistanceKm")}
            />
          </Field>
          <Field label="Duration (min, manual)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={f.estimatedDurationMin}
              onChange={set("estimatedDurationMin")}
            />
          </Field>
          <Field label="Description">
            <input
              className={inputCls}
              value={f.description}
              onChange={set("description")}
            />
          </Field>
          <Field label="Vehicle">
            <select
              className={inputCls}
              value={f.assignedVehicle}
              onChange={set("assignedVehicle")}
            >
              <option value="">— None —</option>
              {vehicles.data?.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Driver">
            <select
              className={inputCls}
              value={f.assignedDriver}
              onChange={set("assignedDriver")}
            >
              <option value="">— None —</option>
              {drivers.data?.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1">
            Operating days
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = f.operatingDays.includes(i);
              return (
                <button
                  type="button"
                  key={d}
                  aria-pressed={on}
                  onClick={() =>
                    setF({
                      ...f,
                      operatingDays: on
                        ? f.operatingDays.filter((x) => x !== i)
                        : [...f.operatingDays, i].sort(),
                    })
                  }
                  className={`border-2 border-black px-3 py-1 text-xs font-bold ${on ? "bg-[#024BAB] text-white" : "bg-white"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider">
              Stops ({stops.length}) — click the map to add
            </p>
            <button
              type="button"
              onClick={() => setStops([...stops, blankStop()])}
              className="border-2 border-black bg-white px-2 py-1 text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add stop
            </button>
          </div>
          <RouteMap
            stops={stops.map((s) => ({
              lat: parseFloat(s.lat),
              lng: parseFloat(s.lng),
            }))}
            onAdd={(lat, lng) =>
              setStops([
                ...stops,
                {
                  ...blankStop(lat.toFixed(6), lng.toFixed(6)),
                  name: `Stop ${stops.length + 1}`,
                },
              ])
            }
          />
          <div className="mt-3 space-y-2">
            {stops.length === 0 && (
              <p className="text-sm text-muted-foreground font-medium">
                No stops yet. A route needs at least 2 active stops before it
                can be activated.
              </p>
            )}
            {stops.map((s, i) => (
              <div key={i} className="border-2 border-black p-2 bg-white">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 border-2 border-black bg-[#FA731C] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <input
                    required
                    aria-label="Stop name"
                    placeholder="Stop name"
                    className={`${inputCls} flex-1`}
                    value={s.name}
                    onChange={(e) => setStop(i, "name", e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="border-2 border-black p-1 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                    disabled={i === stops.length - 1}
                    className="border-2 border-black p-1 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove stop"
                    onClick={() => setStops(stops.filter((_, j) => j !== i))}
                    className="border-2 border-black p-1 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                  <input
                    required
                    aria-label="Latitude"
                    placeholder="Lat"
                    type="number"
                    step="any"
                    className={inputCls}
                    value={s.lat}
                    onChange={(e) => setStop(i, "lat", e.target.value)}
                  />
                  <input
                    required
                    aria-label="Longitude"
                    placeholder="Lng"
                    type="number"
                    step="any"
                    className={inputCls}
                    value={s.lng}
                    onChange={(e) => setStop(i, "lng", e.target.value)}
                  />
                  <input
                    aria-label="Arrival"
                    type="time"
                    className={inputCls}
                    value={s.plannedArrival}
                    onChange={(e) =>
                      setStop(i, "plannedArrival", e.target.value)
                    }
                  />
                  <input
                    aria-label="Departure"
                    type="time"
                    className={inputCls}
                    value={s.plannedDeparture}
                    onChange={(e) =>
                      setStop(i, "plannedDeparture", e.target.value)
                    }
                  />
                  <label className="flex items-center gap-1 font-semibold">
                    <input
                      type="checkbox"
                      checked={s.allowsPickup}
                      onChange={(e) =>
                        setStop(i, "allowsPickup", e.target.checked)
                      }
                    />{" "}
                    Pickup
                  </label>
                  <label className="flex items-center gap-1 font-semibold">
                    <input
                      type="checkbox"
                      checked={s.allowsDropoff}
                      onChange={(e) =>
                        setStop(i, "allowsDropoff", e.target.checked)
                      }
                    />{" "}
                    Drop-off
                  </label>
                </div>
              </div>
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
            {save.isPending ? "Saving…" : "Save route"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export default function RoutesPage() {
  const { can } = useAuth();
  const canWrite = can("routes:write");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [form, setForm] = useState(null);
  const [dup, setDup] = useState(null);
  const [dupCode, setDupCode] = useState("");
  const [archive, setArchive] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["routes", page, search, active],
    queryFn: () => get("/routes", { page, limit: 15, search, active }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["routes"] });
  const fail = (title) => (e) =>
    toast({ title, description: errMsg(e), variant: "destructive" });

  const toggle = useMutation({
    mutationFn: (r) => patch(`/routes/${r._id}/active`, { active: !r.active }),
    onSuccess: refresh,
    onError: fail("Could not change route"),
  });
  const dupMut = useMutation({
    mutationFn: () => post(`/routes/${dup._id}/duplicate`, { code: dupCode }),
    onSuccess: () => {
      refresh();
      toast({ title: "Route duplicated", variant: "success" });
      setDup(null);
      setDupCode("");
    },
    onError: fail("Could not duplicate"),
  });
  const archiveMut = useMutation({
    mutationFn: (id) => del(`/routes/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Route archived", variant: "success" });
      setArchive(null);
    },
    onError: (e) => {
      fail("Cannot archive")(e);
      setArchive(null);
    },
  });
  const filtered = !!(search || active);

  return (
    <AppLayout title="Routes">
      <PageHeader
        title="Routes & stops"
        subtitle="Plan routes; trips snapshot the route version when created"
        actions={
          canWrite && (
            <PrimaryButton onClick={() => setForm("new")}>
              <Plus className="w-4 h-4" /> New route
            </PrimaryButton>
          )
        }
      />
      <div className="flex flex-wrap gap-2 mb-4">
        <SearchInput
          value={search}
          onChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          placeholder="Search by name or code"
        />
        <FilterSelect
          value={active}
          onChange={(s) => {
            setActive(s);
            setPage(1);
          }}
          all="All Status"
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
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
            icon={RouteIcon}
            title={filtered ? "No routes match your filters" : "No routes yet"}
            message={
              filtered
                ? "Try a different search."
                : "Create a route with at least two stops, then activate it."
            }
            action={
              !filtered && canWrite ? (
                <PrimaryButton onClick={() => setForm("new")}>
                  New route
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Code",
            cell: (r) => <span className="font-bold">{r.code}</span>,
          },
          { header: "Name", cell: (r) => r.name },
          { header: "Stops", cell: (r) => r.stops.length },
          {
            header: "Distance",
            cell: (r) =>
              r.plannedDistanceKm != null ? `${r.plannedDistanceKm} km` : "—",
          },
          {
            header: "Time",
            cell: (r) =>
              r.startTime
                ? `${r.startTime}${r.endTime ? `–${r.endTime}` : ""}`
                : "—",
          },
          {
            header: "Vehicle / Driver",
            cell: (r) =>
              `${r.assignedVehicle?.registrationNumber ?? "—"} / ${r.assignedDriver?.name ?? "—"}`,
          },
          {
            header: "Status",
            cell: (r) => (
              <span
                className={`nb-badge uppercase ${r.active ? "nb-tag-green" : "nb-tag-white"}`}
              >
                {r.active ? "Active" : "Inactive"}
              </span>
            ),
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
                        title={r.active ? "Deactivate" : "Activate"}
                        aria-label={r.active ? "Deactivate" : "Activate"}
                        onClick={() => toggle.mutate(r)}
                        className="border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Duplicate"
                        aria-label="Duplicate"
                        onClick={() => setDup(r)}
                        className="border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
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
        <RouteForm
          route={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {dup && (
        <Modal title={`Duplicate ${dup.code}`} onClose={() => setDup(null)}>
          <Field label="New route code" required>
            <input
              className={inputCls}
              value={dupCode}
              onChange={(e) => setDupCode(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground font-medium mt-2">
            The copy is inactive and has no vehicle or driver assigned.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setDup(null)}
              className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
            >
              Cancel
            </button>
            <PrimaryButton
              disabled={!dupCode || dupMut.isPending}
              onClick={() => dupMut.mutate()}
            >
              Duplicate
            </PrimaryButton>
          </div>
        </Modal>
      )}
      {archive && (
        <ConfirmationDialog
          danger
          title="Archive route"
          message={`Archive ${archive.code}? Inactive routes only. Past trips keep their route snapshot.`}
          confirmLabel="Archive"
          busy={archiveMut.isPending}
          onConfirm={() => archiveMut.mutate(archive._id)}
          onClose={() => setArchive(null)}
        />
      )}
    </AppLayout>
  );
}
