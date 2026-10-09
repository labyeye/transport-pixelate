import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  WifiOff,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { LiveMap, FRESH_COLOR } from "@/components/common/LiveMap";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { del, get, patch, post } from "@/services/api";
import { errMsg } from "@/lib/errors";

// Mirrors the server thresholds; recomputed locally every few seconds so a silent vehicle turns stale on its own.
const freshnessOf = (iso, now) => {
  if (!iso) return "no_signal";
  const age = now - new Date(iso).getTime();
  return age <= 120_000 ? "live" : age <= 900_000 ? "stale" : "offline";
};
const LABEL = {
  live: "Live",
  stale: "Stale",
  offline: "Offline",
  no_signal: "No signal",
};
const TONE = {
  live: "nb-tag-green",
  stale: "nb-tag-yellow",
  offline: "nb-tag-white",
  no_signal: "nb-tag-white",
};
const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)} min ago`
      : s < 86400
        ? `${Math.round(s / 3600)} h ago`
        : `${Math.round(s / 86400)} d ago`;
};

function DeviceCreate({ onClose }) {
  const qc = useQueryClient();
  const vehicles = useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });
  const [f, setF] = useState({ name: "", vehicle: "", externalId: "" });
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const save = useMutation({
    mutationFn: () =>
      post("/tracking/devices", {
        name: f.name,
        vehicle: f.vehicle,
        externalId: f.externalId || undefined,
      }),
    onSuccess: (r) => {
      setCreated(r.data);
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => setError(errMsg(e)),
  });
  if (created) return <KeyModal device={created} onClose={onClose} />;
  return (
    <Modal title="Add GPS device" onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <div className="space-y-3">
        <Field label="Device name" required>
          <input
            className={inputCls}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Vehicle" required>
          <select
            className={inputCls}
            value={f.vehicle}
            onChange={(e) => setF({ ...f, vehicle: e.target.value })}
          >
            <option value="">Select…</option>
            {vehicles.data?.map((v) => (
              <option key={v._id} value={v._id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label="IMEI / serial (optional)">
          <input
            className={inputCls}
            value={f.externalId}
            onChange={(e) => setF({ ...f, externalId: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Cancel
        </button>
        <PrimaryButton
          disabled={f.name.trim().length < 2 || !f.vehicle || save.isPending}
          onClick={() => save.mutate()}
        >
          Create device
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function KeyModal({ device, onClose }) {
  const { toast } = useToast();
  const origin = window.location.origin;
  const sample = `curl -X POST ${origin}/api/v1/tracking/ingest \\\n  -H "Authorization: Device ${device.publicId}:${device.apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"lat":19.076,"lng":72.8777,"timestamp":"<ISO time>","speedKmh":32}'`;
  return (
    <Modal title="Device credentials" onClose={onClose} wide>
      <div className="border-2 border-[#FA731C] bg-orange-50 p-3 text-sm font-semibold mb-3 flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Copy the key now.
        It is shown only once and cannot be retrieved later (you can rotate it).
      </div>
      <p className="text-xs font-bold uppercase tracking-wider">Device ID</p>
      <p className="font-mono text-sm mb-2">{device.publicId}</p>
      <p className="text-xs font-bold uppercase tracking-wider">API key</p>
      <div className="flex gap-2 mb-3">
        <code className="font-mono text-xs break-all border-2 border-black p-2 bg-white flex-1">
          {device.apiKey}
        </code>
        <button
          aria-label="Copy key"
          onClick={() => {
            navigator.clipboard?.writeText(device.apiKey);
            toast({ title: "Copied", variant: "success" });
          }}
          className="border-2 border-black p-2"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs font-bold uppercase tracking-wider">
        Example request
      </p>
      <pre className="font-mono text-xs border-2 border-black p-2 bg-white overflow-auto whitespace-pre-wrap">
        {sample}
      </pre>
      <p className="text-xs text-muted-foreground font-medium mt-2">
        Hardware trackers usually speak their own protocol, so each model needs
        an adapter that has been tested against the real device. Only the
        generic JSON format above is available today.
      </p>
      <div className="flex justify-end mt-4">
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      </div>
    </Modal>
  );
}

function Devices() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => (await get("/tracking/devices")).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["devices"] });
  const rotate = useMutation({
    mutationFn: (d) => post(`/tracking/devices/${d._id}/rotate-key`),
    onSuccess: (r) => setKey(r.data),
    onError: (e) =>
      toast({
        title: "Failed",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const toggle = useMutation({
    mutationFn: (d) =>
      patch(`/tracking/devices/${d._id}`, { active: !d.active }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (d) => del(`/tracking/devices/${d._id}`),
    onSuccess: refresh,
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryButton onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> Add device
        </PrimaryButton>
      </div>
      <DataTable
        loading={isLoading}
        rows={data ?? []}
        onPage={() => {}}
        empty={
          <EmptyState
            icon={Radio}
            title="No GPS devices"
            message="Register a tracker for a vehicle to receive its location. Drivers' phones report automatically during their own active trips."
            action={
              <PrimaryButton onClick={() => setAdding(true)}>
                Add device
              </PrimaryButton>
            }
          />
        }
        columns={[
          {
            header: "Device",
            cell: (d) => (
              <div>
                <p className="font-bold">{d.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {d.publicId}
                </p>
              </div>
            ),
          },
          { header: "Vehicle", cell: (d) => d.vehicle?.registrationNumber },
          {
            header: "Last data",
            cell: (d) =>
              d.lastFixAt ? (
                new Date(d.lastFixAt).toLocaleString("en-IN")
              ) : (
                <span className="text-muted-foreground">Never</span>
              ),
          },
          {
            header: "Status",
            cell: (d) => (
              <span
                className={`nb-badge uppercase ${d.active ? "nb-tag-green" : "nb-tag-white"}`}
              >
                {d.active ? "Enabled" : "Disabled"}
              </span>
            ),
          },
          {
            header: "Actions",
            cell: (d) => (
              <div className="flex gap-1">
                <button
                  title="Rotate key"
                  aria-label="Rotate key"
                  onClick={() => rotate.mutate(d)}
                  className="border-2 border-black p-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => toggle.mutate(d)}
                  className="border-2 border-black px-2 py-1 text-xs font-bold"
                >
                  {d.active ? "Disable" : "Enable"}
                </button>
                <button
                  title="Delete"
                  aria-label="Delete device"
                  onClick={() =>
                    window.confirm(`Delete ${d.name}?`) && remove.mutate(d)
                  }
                  className="border-2 border-black p-1.5 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                </button>
              </div>
            ),
          },
        ]}
      />
      {adding && <DeviceCreate onClose={() => setAdding(false)} />}
      {key && <KeyModal device={key} onClose={() => setKey(null)} />}
    </div>
  );
}

export default function TrackingPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("map");
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [fresh, setFresh] = useState("");
  const [onTrip, setOnTrip] = useState("");
  const {
    data: res,
    isLoading,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["tracking"],
    queryFn: () => get("/tracking/vehicles"),
    refetchInterval: 60000,
  });
  const trail = useQuery({
    queryKey: ["trail", selected],
    enabled: !!selected,
    queryFn: async () =>
      (
        await get(`/tracking/vehicles/${selected}/history`, {
          from: new Date(Date.now() - 2 * 3600_000).toISOString(),
          limit: 300,
        })
      ).data,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Apply pushed fixes directly to the cached board (only if newer than what we have).
  const onPosition = useCallback(
    (p) => {
      qc.setQueryData(["tracking"], (old) => {
        if (!old) return old;
        return {
          ...old,
          sourceConfigured: true,
          data: old.data.map((row) =>
            row.vehicle._id !== p.vehicleId
              ? row
              : row.position &&
                  new Date(row.position.recordedAt) >= new Date(p.recordedAt)
                ? row
                : {
                    ...row,
                    position: {
                      ...row.position,
                      lat: p.lat,
                      lng: p.lng,
                      speedKmh: p.speedKmh,
                      heading: p.heading,
                      recordedAt: p.recordedAt,
                      source: p.source,
                    },
                  },
          ),
        };
      });
    },
    [qc],
  );
  const onTripStatus = useCallback(
    () => qc.invalidateQueries({ queryKey: ["tracking"] }),
    [qc],
  );
  const connected = useLiveSocket({
    "vehicle:position": onPosition,
    "trip:status": onTripStatus,
  });

  const rows = useMemo(
    () =>
      (res?.data ?? []).map((r) => ({
        ...r,
        freshness: freshnessOf(r.position?.recordedAt, now),
      })),
    [res, now],
  );
  const filtered = rows.filter(
    (r) =>
      (!search ||
        r.vehicle.registrationNumber
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        r.trip?.driver?.name?.toLowerCase().includes(search.toLowerCase())) &&
      (!fresh || r.freshness === fresh) &&
      (!onTrip || (onTrip === "yes" ? !!r.trip : !r.trip)),
  );
  const markers = filtered.map((r) => ({
    id: r.vehicle._id,
    lat: r.position?.lat,
    lng: r.position?.lng,
    freshness: r.freshness,
    label: r.vehicle.registrationNumber,
  }));
  const sel = rows.find((r) => r.vehicle._id === selected);
  const noSource = res && !res.sourceConfigured;
  const counts = rows.reduce(
    (c, r) => ({ ...c, [r.freshness]: (c[r.freshness] ?? 0) + 1 }),
    {},
  );

  return (
    <AppLayout title="Live Tracking">
      <PageHeader
        title="Live tracking"
        subtitle="Locations come from registered GPS devices and drivers' phones during active trips"
      />
      <div className="flex gap-2 mb-4">
        {[
          ["map", "Map"],
          ...(can("tracking:write") ? [["devices", "GPS devices"]] : []),
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
      {tab === "devices" ? (
        <Devices />
      ) : (
        <>
          {noSource && (
            <div className="border-2 border-black bg-[#FBBF24]/30 p-3 mb-4 flex gap-2 text-sm font-semibold">
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                No GPS source is connected, so no vehicle locations are
                available.{" "}
                {can("tracking:write")
                  ? "Register a device under “GPS devices”, or start a trip with a driver using the mobile app."
                  : "Ask an administrator to connect a GPS device."}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs font-bold">
            <span
              className={`nb-badge ${connected ? "nb-tag-green" : "nb-tag-red"}`}
            >
              {connected
                ? "Realtime connected"
                : "Realtime disconnected — refreshing every minute"}
            </span>
            {["live", "stale", "offline", "no_signal"].map((k) => (
              <span key={k} className="flex items-center gap-1">
                <i
                  className="inline-block w-3 h-3 border border-black"
                  style={{ background: FRESH_COLOR[k] }}
                />
                {LABEL[k]} {counts[k] ?? 0}
              </span>
            ))}
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["tracking"] })}
              aria-label="Refresh"
              className="border-2 border-black p-1 ml-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Vehicle or driver"
            />
            <FilterSelect
              value={fresh}
              onChange={setFresh}
              all="Any signal"
              options={Object.entries(LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <FilterSelect
              value={onTrip}
              onChange={setOnTrip}
              all="All vehicles"
              options={[
                { value: "yes", label: "On a trip" },
                { value: "no", label: "Not on a trip" },
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
          {isLoading ? (
            <div className="h-96 border-2 border-black bg-white animate-pulse" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No vehicles"
              message="Add vehicles first, then connect GPS."
            />
          ) : (
            <div className="grid lg:grid-cols-3 gap-3 lg:h-[560px]">
              <div className="lg:col-span-2">
                <LiveMap
                  markers={markers}
                  selectedId={selected}
                  onSelect={setSelected}
                  trail={trail.data}
                />
              </div>
              <div className="border-2 border-black bg-white overflow-auto max-h-[560px]">
                {sel && (
                  <div className="p-3 border-b-2 border-black bg-[#024BAB]/5 text-sm space-y-1">
                    <p className="font-bold text-base">
                      {sel.vehicle.registrationNumber}{" "}
                      <span
                        className={`nb-badge uppercase ml-1 ${TONE[sel.freshness]}`}
                      >
                        {LABEL[sel.freshness]}
                      </span>
                    </p>
                    {sel.position ? (
                      <>
                        <p>
                          Last update:{" "}
                          <b>{ago(sel.position.recordedAt, now)}</b>{" "}
                          <span className="text-muted-foreground">
                            (
                            {new Date(sel.position.recordedAt).toLocaleString(
                              "en-IN",
                            )}
                            )
                          </span>
                        </p>
                        {sel.freshness !== "live" && (
                          <p className="text-xs font-semibold text-red-700">
                            This is the last known position, not the current
                            one.
                          </p>
                        )}
                        {sel.position.speedKmh != null && (
                          <p>Speed: {Math.round(sel.position.speedKmh)} km/h</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Source:{" "}
                          {sel.position.source === "mobile"
                            ? "Driver phone"
                            : "GPS device"}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        No location has ever been received.
                      </p>
                    )}
                    {sel.trip ? (
                      <>
                        <p>
                          Trip: <b>{sel.trip.tripNumber}</b> ·{" "}
                          {sel.trip.status.replace("_", " ")}
                        </p>
                        <p>Route: {sel.trip.route}</p>
                        <p>
                          Driver: {sel.trip.driver?.name ?? "—"}
                          {sel.trip.driver?.phone
                            ? ` · ${sel.trip.driver.phone}`
                            : ""}
                        </p>
                        {sel.trip.nextStop && (
                          <p>Next stop: {sel.trip.nextStop}</p>
                        )}
                        {sel.trip.status === "delayed" && (
                          <p className="text-xs font-bold text-orange-700">
                            Trip is delayed
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Not on a trip.</p>
                    )}
                  </div>
                )}
                <ul className="divide-y divide-black/10">
                  {filtered.length === 0 && (
                    <li className="p-3 text-sm text-muted-foreground">
                      No vehicles match.
                    </li>
                  )}
                  {filtered.map((r) => (
                    <li key={r.vehicle._id}>
                      <button
                        onClick={() => setSelected(r.vehicle._id)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#024BAB]/5 ${selected === r.vehicle._id ? "bg-[#024BAB]/10" : ""}`}
                      >
                        <span>
                          <b className="text-sm">
                            {r.vehicle.registrationNumber}
                          </b>
                          <span className="block text-xs text-muted-foreground">
                            {r.trip
                              ? `${r.trip.tripNumber} · ${r.trip.driver?.name ?? ""}`
                              : "Idle"}{" "}
                            ·{" "}
                            {r.position
                              ? ago(r.position.recordedAt, now)
                              : "never"}
                          </span>
                        </span>
                        <span
                          className={`nb-badge uppercase ${TONE[r.freshness]}`}
                        >
                          {LABEL[r.freshness]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {dataUpdatedAt > 0 && (
            <p className="text-xs text-muted-foreground font-medium mt-2">
              Board loaded {new Date(dataUpdatedAt).toLocaleTimeString("en-IN")}
              . Arrival estimates are not shown because no routing provider is
              configured.
            </p>
          )}
        </>
      )}
    </AppLayout>
  );
}
