import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Link2, Pencil, Plus, UserRound, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";

function PassengerForm({ passenger, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    name: passenger?.name ?? "",
    kind: passenger?.kind ?? "student",
    identifier: passenger?.identifier ?? "",
    grade: passenger?.grade ?? "",
    phone: passenger?.phone ?? "",
    gName: passenger?.guardian?.name ?? "",
    gPhone: passenger?.guardian?.phone ?? "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        kind: f.kind,
        identifier: f.identifier || undefined,
        grade: f.grade || undefined,
        phone: f.phone || undefined,
        guardian:
          f.gName || f.gPhone
            ? { name: f.gName || undefined, phone: f.gPhone || undefined }
            : undefined,
      };
      return passenger
        ? put(`/passengers/${passenger._id}`, body)
        : post("/passengers", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passengers"] });
      toast({ title: "Saved", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={passenger ? "Edit passenger" : "Add passenger"}
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
          <Field label="Name" required>
            <input
              required
              className={inputCls}
              value={f.name}
              onChange={set("name")}
            />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={f.kind} onChange={set("kind")}>
              <option value="student">Student</option>
              <option value="employee">Employee</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="ID / admission no.">
            <input
              className={inputCls}
              value={f.identifier}
              onChange={set("identifier")}
            />
          </Field>
          <Field label="Class / department">
            <input
              className={inputCls}
              value={f.grade}
              onChange={set("grade")}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              value={f.phone}
              onChange={set("phone")}
            />
          </Field>
          <span />
          <Field label="Guardian name">
            <input
              className={inputCls}
              value={f.gName}
              onChange={set("gName")}
            />
          </Field>
          <Field label="Guardian phone">
            <input
              className={inputCls}
              value={f.gPhone}
              onChange={set("gPhone")}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AssignDialog({ passenger, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const routes = useQuery({
    queryKey: ["routes", "pick"],
    queryFn: async () => (await get("/routes", { limit: 100 })).data,
  });
  const [route, setRoute] = useState("");
  const [pickupStop, setPickup] = useState("");
  const [dropStop, setDrop] = useState("");
  const [error, setError] = useState("");
  const selected = routes.data?.find((r) => r._id === route);
  const stops = selected?.stops.filter((s) => s.active) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["passengers"] });
  const save = useMutation({
    mutationFn: () =>
      post(`/passengers/${passenger._id}/assignments`, {
        route,
        pickupStop,
        dropStop,
      }),
    onSuccess: () => {
      refresh();
      toast({ title: "Assigned", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (aid) => del(`/passengers/${passenger._id}/assignments/${aid}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Modal title={`Route assignment · ${passenger.name}`} onClose={onClose}>
      {passenger.assignments.length > 0 && (
        <ul className="border-2 border-black divide-y divide-black/10 mb-4">
          {passenger.assignments.map((a) => (
            <li
              key={a._id}
              className="px-3 py-2 text-sm flex items-center justify-between"
            >
              <span>
                <b>{a.route?.code}</b> · {a.pickupStop} → {a.dropStop}
              </span>
              <button
                aria-label="Remove assignment"
                onClick={() => remove.mutate(a._id)}
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <div className="space-y-3">
        <Field label="Route">
          <select
            className={inputCls}
            value={route}
            onChange={(e) => {
              setRoute(e.target.value);
              setPickup("");
              setDrop("");
            }}
          >
            <option value="">Select…</option>
            {routes.data?.map((r) => (
              <option key={r._id} value={r._id}>
                {r.code} · {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pickup stop">
          <select
            className={inputCls}
            value={pickupStop}
            onChange={(e) => setPickup(e.target.value)}
          >
            <option value="">Select…</option>
            {stops
              .filter((s) => s.allowsPickup)
              .map((s) => (
                <option key={s.sequence} value={s.name}>
                  {s.sequence}. {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Drop stop">
          <select
            className={inputCls}
            value={dropStop}
            onChange={(e) => setDrop(e.target.value)}
          >
            <option value="">Select…</option>
            {stops
              .filter((s) => s.allowsDropoff)
              .map((s) => (
                <option key={s.sequence} value={s.name}>
                  {s.sequence}. {s.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Close
        </button>
        <PrimaryButton
          disabled={!route || !pickupStop || !dropStop || save.isPending}
          onClick={() => save.mutate()}
        >
          Assign
        </PrimaryButton>
      </div>
    </Modal>
  );
}

export default function PassengersPage() {
  const { can } = useAuth();
  const canWrite = can("passengers:write");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [form, setForm] = useState(null);
  const [assign, setAssign] = useState(null);
  const [archive, setArchive] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["passengers", page, search, kind],
    queryFn: () => get("/passengers", { page, limit: 15, search, kind }),
  });
  const archiveMut = useMutation({
    mutationFn: (id) => del(`/passengers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passengers"] });
      toast({ title: "Passenger archived", variant: "success" });
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
  const filtered = !!(search || kind);
  return (
    <AppLayout title="Passengers">
      <PageHeader
        title="Passengers"
        subtitle="Riders and their route, pickup and drop stops"
        actions={
          canWrite && (
            <PrimaryButton onClick={() => setForm("new")}>
              <Plus className="w-4 h-4" /> Add passenger
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
          placeholder="Search by name or ID"
        />
        <FilterSelect
          value={kind}
          onChange={(s) => {
            setKind(s);
            setPage(1);
          }}
          all="All Types"
          options={[
            { value: "student", label: "Students" },
            { value: "employee", label: "Employees" },
            { value: "other", label: "Other" },
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
            icon={UserRound}
            title={filtered ? "No passengers match" : "No passengers yet"}
            message="Add passengers and assign them to a route to build trip manifests."
            action={
              !filtered && canWrite ? (
                <PrimaryButton onClick={() => setForm("new")}>
                  Add passenger
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Name",
            cell: (p) => (
              <div>
                <p className="font-bold">{p.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {p.kind}
                  {p.grade ? ` · ${p.grade}` : ""}
                </p>
              </div>
            ),
          },
          { header: "ID", cell: (p) => p.identifier ?? "—" },
          {
            header: "Guardian",
            cell: (p) =>
              p.guardian?.name
                ? `${p.guardian.name}${p.guardian.phone ? ` · ${p.guardian.phone}` : ""}`
                : "—",
          },
          {
            header: "Route",
            cell: (p) =>
              p.assignments.length ? (
                p.assignments
                  .map((a) => `${a.route?.code}: ${a.pickupStop}→${a.dropStop}`)
                  .join("; ")
              ) : (
                <span className="text-muted-foreground">Not assigned</span>
              ),
          },
          ...(canWrite
            ? [
                {
                  header: "Actions",
                  cell: (p) => (
                    <div className="flex gap-1">
                      <button
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => setForm(p)}
                        className="border-2 border-black p-1.5"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Assign route"
                        aria-label="Assign route"
                        onClick={() => setAssign(p)}
                        className="border-2 border-black p-1.5"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Archive"
                        aria-label="Archive"
                        onClick={() => setArchive(p)}
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
        <PassengerForm
          passenger={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {assign && (
        <AssignDialog passenger={assign} onClose={() => setAssign(null)} />
      )}
      {archive && (
        <ConfirmationDialog
          danger
          title="Archive passenger"
          message={`Archive ${archive.name}? They'll be removed from route manifests; past trip records are kept.`}
          confirmLabel="Archive"
          busy={archiveMut.isPending}
          onConfirm={() => archiveMut.mutate(archive._id)}
          onClose={() => setArchive(null)}
        />
      )}
    </AppLayout>
  );
}
