import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, MapPin, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton, SecondaryButton } from "@/components/common/PageHeader";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";

const LABEL = {
  overspeed: "Overspeed",
  geofence_enter: "Entered zone",
  geofence_exit: "Left zone",
};
const when = (d) =>
  new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function GeofenceForm({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", lat: "", lng: "", radiusM: 200, alertOn: "both" });
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      post("/alerts/geofences", {
        name: f.name,
        center: { lat: Number(f.lat), lng: Number(f.lng) },
        radiusM: Number(f.radiusM),
        alertOn: f.alertOn,
      }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New geofence" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" required>
          <input className={inputCls} value={f.name} onChange={set("name")} placeholder="School gate" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" required>
            <input className={inputCls} type="number" step="any" value={f.lat} onChange={set("lat")} />
          </Field>
          <Field label="Longitude" required>
            <input className={inputCls} type="number" step="any" value={f.lng} onChange={set("lng")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Radius (metres)" required>
            <input className={inputCls} type="number" min={20} value={f.radiusM} onChange={set("radiusM")} />
          </Field>
          <Field label="Alert when a vehicle">
            <select className={inputCls} value={f.alertOn} onChange={set("alertOn")}>
              <option value="both">Enters or leaves</option>
              <option value="enter">Enters</option>
              <option value="exit">Leaves</option>
            </select>
          </Field>
        </div>
        {error && (
          <div role="alert" className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        <PrimaryButton disabled={!f.name || f.lat === "" || f.lng === "" || save.isPending} onClick={() => save.mutate()}>
          Save geofence
        </PrimaryButton>
      </div>
    </Modal>
  );
}

export default function AlertsPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = can("tracking:write");
  const [tab, setTab] = useState("alerts");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["alerts"] });

  const alerts = useQuery({
    queryKey: ["alerts", "list", page],
    queryFn: () => get(`/alerts?page=${page}&limit=20`),
    refetchInterval: 30_000,
  });
  const fences = useQuery({
    queryKey: ["alerts", "geofences"],
    queryFn: async () => (await get("/alerts/geofences")).data,
  });
  const settings = useQuery({
    queryKey: ["alerts", "settings"],
    queryFn: async () => (await get("/alerts/settings")).data,
  });
  const ack = useMutation({
    mutationFn: (id) => post(`/alerts/${id}/acknowledge`),
    onSuccess: refresh,
    onError: (e) => toast({ title: errMsg(e), variant: "error" }),
  });
  const archive = useMutation({
    mutationFn: (id) => del(`/alerts/geofences/${id}`),
    onSuccess: refresh,
  });
  const saveLimit = useMutation({
    mutationFn: () =>
      put("/alerts/settings", { speedLimitKmh: limit === "" ? null : Number(limit) }),
    onSuccess: () => {
      toast({ title: "Speed limit saved", variant: "success" });
      refresh();
    },
    onError: (e) => toast({ title: errMsg(e), variant: "error" }),
  });
  const current = settings.data?.speedLimitKmh;

  const alertCols = [
    { header: "When", cell: (a) => when(a.at) },
    { header: "Vehicle", cell: (a) => a.vehicle?.registrationNumber ?? "—" },
    { header: "Alert", cell: (a) => LABEL[a.type] ?? a.type },
    {
      header: "Details",
      cell: (a) =>
        a.type === "overspeed"
          ? `${Math.round(a.speedKmh)} km/h (limit ${a.limitKmh})`
          : a.geofenceName,
    },
    {
      header: "",
      cell: (a) =>
        a.acknowledgedAt ? (
          <span className="text-xs font-semibold text-muted-foreground">Acknowledged</span>
        ) : canWrite ? (
          <SecondaryButton onClick={() => ack.mutate(a._id)}>Acknowledge</SecondaryButton>
        ) : null,
    },
  ];
  const fenceCols = [
    { header: "Name", cell: (g) => g.name },
    { header: "Radius", cell: (g) => `${g.radiusM} m` },
    { header: "Alerts on", cell: (g) => ({ both: "Enter & leave", enter: "Enter", exit: "Leave" })[g.alertOn] },
    {
      header: "",
      cell: (g) =>
        canWrite ? <SecondaryButton onClick={() => archive.mutate(g._id)}>Remove</SecondaryButton> : null,
    },
  ];

  return (
    <AppLayout title="Alerts">
      <PageHeader
        title="Alerts & geofences"
        subtitle="Overspeed and zone entry/exit, raised from live vehicle positions"
        actions={
          canWrite && tab === "geofences" ? (
            <PrimaryButton onClick={() => setAdding(true)}>
              <Plus size={16} /> New geofence
            </PrimaryButton>
          ) : null
        }
      />
      <div className="flex gap-2 mb-4">
        {[["alerts", "Alerts"], ["geofences", "Geofences & speed limit"]].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-2 border-black px-3 py-1.5 text-sm font-bold ${tab === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "alerts" ? (
        <DataTable
          columns={alertCols}
          rows={alerts.data?.data ?? []}
          loading={alerts.isLoading}
          meta={alerts.data?.meta}
          onPage={setPage}
          empty={<EmptyState icon={BellRing} title="No alerts yet" message="Set a speed limit or add a geofence to start." />}
        />
      ) : (
        <div className="space-y-5">
          <div className="border-2 border-black bg-white p-4 max-w-md">
            <Field label="Speed limit (km/h) — leave empty to switch overspeed alerts off">
              <input
                className={inputCls}
                type="number"
                min={10}
                max={200}
                placeholder={current ? String(current) : "e.g. 60"}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                disabled={!canWrite}
              />
            </Field>
            <p className="text-xs font-semibold mt-2">
              Current: {current ? `${current} km/h` : "off"}
            </p>
            {canWrite && (
              <PrimaryButton className="mt-3" disabled={saveLimit.isPending} onClick={() => saveLimit.mutate()}>
                Save speed limit
              </PrimaryButton>
            )}
          </div>
          <DataTable
            columns={fenceCols}
            rows={fences.data ?? []}
            loading={fences.isLoading}
            empty={<EmptyState icon={MapPin} title="No geofences" message="Add a school gate, depot or restricted area." />}
          />
        </div>
      )}
      {adding && (
        <GeofenceForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </AppLayout>
  );
}
