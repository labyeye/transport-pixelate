import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, openFile, post, put, upload } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatDateOrDash } from "@/lib/utils";

const VEHICLE_TYPES = [
  "registration",
  "insurance",
  "fitness",
  "permit",
  "pollution",
  "other",
];
const DRIVER_TYPES = ["licence", "identity", "other"];
const EXPIRY = {
  expired: ["Expired", "nb-tag-red"],
  expiring_soon: ["Expiring soon", "nb-tag-yellow"],
  valid: ["Valid", "nb-tag-green"],
  no_expiry: ["No expiry", "nb-tag-white"],
};
const VERIF = {
  pending: ["Awaiting verification", "nb-tag-yellow"],
  verified: ["Verified", "nb-tag-green"],
  rejected: ["Rejected", "nb-tag-red"],
};
const d10 = (v) => (v ? String(v).slice(0, 10) : "");
const label = (s) => s.replace("_", " ");

function DocForm({ doc, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const file = useRef(null);
  const vehicles = useQuery({
    queryKey: ["vehicles", "pick"],
    queryFn: async () => (await get("/vehicles", { limit: 100 })).data,
  });
  const drivers = useQuery({
    queryKey: ["drivers", "pick"],
    queryFn: async () => (await get("/drivers", { limit: 100 })).data,
  });
  const [f, setF] = useState({
    ownerType: doc?.ownerType ?? "vehicle",
    owner: doc?.owner ?? "",
    type: doc?.type ?? "insurance",
    number: doc?.number ?? "",
    issueDate: d10(doc?.issueDate),
    expiryDate: d10(doc?.expiryDate),
    notes: doc?.notes ?? "",
  });
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const types = f.ownerType === "driver" ? DRIVER_TYPES : VEHICLE_TYPES;
  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      const fields = doc
        ? {
            type: f.type,
            number: f.number,
            issueDate: f.issueDate,
            expiryDate: f.expiryDate,
            notes: f.notes,
          }
        : f;
      Object.entries(fields).forEach(([k, v]) => v !== "" && form.append(k, v));
      const picked = file.current?.files?.[0];
      if (picked) form.append("file", picked);
      return upload(
        doc ? `/documents/${doc._id}` : "/documents",
        form,
        doc ? "PUT" : "POST",
      );
    },
    onSuccess: () => {
      ["documents", "dashboard", "vehicles", "drivers"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({
        title: doc ? "Document updated" : "Document uploaded",
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={doc ? "Edit document" : "Upload document"}
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
          {!doc && (
            <Field label="Belongs to">
              <select
                className={inputCls}
                value={f.ownerType}
                onChange={(e) =>
                  setF({
                    ...f,
                    ownerType: e.target.value,
                    owner: "",
                    type: e.target.value === "driver" ? "licence" : "insurance",
                  })
                }
              >
                <option value="vehicle">Vehicle</option>
                <option value="driver">Driver / staff</option>
              </select>
            </Field>
          )}
          {!doc && (
            <Field
              label={f.ownerType === "vehicle" ? "Vehicle" : "Person"}
              required
            >
              <select
                required
                className={inputCls}
                value={f.owner}
                onChange={set("owner")}
              >
                <option value="">Select…</option>
                {(f.ownerType === "vehicle"
                  ? vehicles.data
                  : drivers.data
                )?.map((o) => (
                  <option key={o._id} value={o._id}>
                    {o.registrationNumber ?? o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Document type">
            <select className={inputCls} value={f.type} onChange={set("type")}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Document number">
            <input
              className={inputCls}
              value={f.number}
              onChange={set("number")}
            />
          </Field>
          <Field label="Issue date">
            <input
              type="date"
              className={inputCls}
              value={f.issueDate}
              onChange={set("issueDate")}
            />
          </Field>
          <Field label="Expiry date">
            <input
              type="date"
              className={inputCls}
              value={f.expiryDate}
              onChange={set("expiryDate")}
            />
          </Field>
        </div>
        <Field label="Notes">
          <input className={inputCls} value={f.notes} onChange={set("notes")} />
        </Field>
        <Field label={doc ? "Replace file (optional)" : "File"} required={!doc}>
          <input
            ref={file}
            required={!doc}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setChosen(e.target.files?.[0]?.name ?? "")}
            className="text-sm font-semibold"
          />
        </Field>
        <p className="text-xs text-muted-foreground font-medium">
          PDF, JPEG, PNG or WebP up to 10 MB. Changing the dates, number, type
          or file sends the document back for verification.
          {chosen ? ` Selected: ${chosen}` : ""}
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
            {save.isPending ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function VerifyDialog({ doc, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: (decision) =>
      post(`/documents/${doc._id}/verify`, {
        decision,
        note: note || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: "Verification saved", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Verify document" onClose={onClose}>
      <p className="text-sm mb-3">
        <b className="capitalize">{doc.type}</b> · {doc.ownerName} ·{" "}
        {doc.number || "no number"}. Open the file and compare it with the
        details before verifying.
      </p>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <Field label="Note (required to reject)">
        <input
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button
          disabled={m.isPending || !note.trim()}
          onClick={() => m.mutate("rejected")}
          className="border-2 border-black bg-[#EF4444] text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          Reject
        </button>
        <button
          disabled={m.isPending}
          onClick={() => m.mutate("verified")}
          className="border-2 border-black bg-[#024BAB] text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          Verify
        </button>
      </div>
    </Modal>
  );
}

function ReminderSettings({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["doc-reminders"],
    queryFn: async () => (await get("/documents/settings/reminders")).data,
  });
  const [text, setText] = useState(null);
  const [error, setError] = useState("");
  const value = text ?? data?.days.join(", ") ?? "";
  const save = useMutation({
    mutationFn: () =>
      put("/documents/settings/reminders", {
        days: value
          .split(/[,\s]+/)
          .filter(Boolean)
          .map(Number),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-reminders"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: "Reminder days saved", variant: "success" });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Expiry reminder days" onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <Field label="Days before expiry (comma separated)">
        <input
          className={inputCls}
          value={value}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground font-medium mt-2">
        Documents within the largest interval show as “expiring soon”. Reminders
        are sent once per interval when notifications are enabled.
      </p>
      <div className="flex justify-end gap-2 mt-4">
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

export default function DocumentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [status, setStatus] = useState("");
  const [verification, setVerification] = useState("");
  const [form, setForm] = useState(null);
  const [verify, setVerify] = useState(null);
  const [archive, setArchive] = useState(null);
  const [settings, setSettings] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["documents", page, search, ownerType, status, verification],
    queryFn: () =>
      get("/documents", {
        page,
        limit: 15,
        search,
        ownerType: ownerType || undefined,
        status,
        verification,
        ...(ownerType ? {} : {}),
      }),
  });
  const sum = useQuery({
    queryKey: ["documents", "summary"],
    queryFn: async () => (await get("/documents/summary")).data,
  });
  const archiveMut = useMutation({
    mutationFn: (id) => del(`/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: "Document archived", variant: "success" });
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
  const open = (doc, download) =>
    openFile(`/documents/${doc._id}/file`, {
      download,
      name: doc.file.originalName,
    }).catch((e) =>
      toast({
        title: "Can't open file",
        description: errMsg(e),
        variant: "destructive",
      }),
    );
  const canUpload = can("vehicles:write") || can("drivers:write");
  const s = sum.data;
  const filtered = !!(search || ownerType || status || verification);
  return (
    <AppLayout title="Documents">
      <PageHeader
        title="Documents & expiry"
        subtitle="Vehicle and driver documents, verification and renewal tracking"
        actions={
          <>
            {can("settings:write") && (
              <SecondaryButton onClick={() => setSettings(true)}>
                <Settings2 className="w-4 h-4" /> Reminders
              </SecondaryButton>
            )}
            {canUpload && (
              <PrimaryButton onClick={() => setForm("new")}>
                <Plus className="w-4 h-4" /> Upload
              </PrimaryButton>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Expired"
          value={s?.expired ?? "—"}
          icon={AlertTriangle}
          color="#EF4444"
          onClick={() => {
            setStatus("expired");
            setPage(1);
          }}
          active={status === "expired"}
        />
        <StatCard
          label={`Expiring (${s?.soonDays ?? 30} d)`}
          value={s?.expiringSoon ?? "—"}
          icon={Clock}
          color="#D97706"
          onClick={() => {
            setStatus("expiring_soon");
            setPage(1);
          }}
          active={status === "expiring_soon"}
        />
        <StatCard
          label="Valid"
          value={s?.valid ?? "—"}
          icon={CheckCircle2}
          color="#00C48C"
          onClick={() => {
            setStatus("valid");
            setPage(1);
          }}
          active={status === "valid"}
        />
        <StatCard
          label="Awaiting verification"
          value={s?.awaitingVerification ?? "—"}
          icon={ShieldCheck}
          onClick={() => {
            setVerification("pending");
            setPage(1);
          }}
          active={verification === "pending"}
        />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search number or file name"
        />
        <FilterSelect
          value={ownerType}
          onChange={(v) => {
            setOwnerType(v);
            setPage(1);
          }}
          all="Vehicles & drivers"
          options={[
            { value: "vehicle", label: "Vehicles" },
            { value: "driver", label: "Drivers" },
          ]}
        />
        {filtered && (
          <button
            onClick={() => {
              setSearch("");
              setOwnerType("");
              setStatus("");
              setVerification("");
              setPage(1);
            }}
            className="flex items-center gap-1 text-xs font-bold border-2 border-black px-2 py-2"
          >
            <X className="w-3.5 h-3.5" /> Clear
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
      <DataTable
        loading={isLoading}
        rows={(data?.data ?? []).filter((d) =>
          ["vehicle", "driver", "organization"].includes(d.ownerType),
        )}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={FileText}
            title={filtered ? "No documents match" : "No documents yet"}
            message="Upload insurance, registration, licences and other records to track their expiry."
            action={
              !filtered && canUpload ? (
                <PrimaryButton onClick={() => setForm("new")}>
                  Upload
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Document",
            cell: (d) => (
              <div>
                <p className="font-bold capitalize">{d.type}</p>
                <p className="text-xs text-muted-foreground">
                  {d.number || d.file.originalName}
                </p>
              </div>
            ),
          },
          {
            header: "Belongs to",
            cell: (d) => (
              <div>
                <p>{d.ownerName ?? "—"}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {d.ownerType}
                </p>
              </div>
            ),
          },
          {
            header: "Expiry",
            cell: (d) => (
              <div>
                <p>{formatDateOrDash(d.expiryDate)}</p>
                <span
                  className={`nb-badge uppercase ${EXPIRY[d.expiryStatus][1]}`}
                >
                  {EXPIRY[d.expiryStatus][0]}
                </span>
              </div>
            ),
          },
          {
            header: "Verification",
            cell: (d) => (
              <div>
                <span
                  className={`nb-badge uppercase ${VERIF[d.verification][1]}`}
                >
                  {VERIF[d.verification][0]}
                </span>
                {d.verificationNote && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {d.verificationNote}
                  </p>
                )}
              </div>
            ),
          },
          {
            header: "Actions",
            cell: (d) => (
              <div className="flex flex-wrap gap-1">
                <button
                  aria-label="View file"
                  title="View"
                  onClick={() => open(d, false)}
                  className="border-2 border-black p-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label="Download"
                  title="Download"
                  onClick={() => open(d, true)}
                  className="border-2 border-black p-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {can("documents:verify") && (
                  <button
                    title="Verify"
                    aria-label="Verify"
                    onClick={() => setVerify(d)}
                    className="border-2 border-black p-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </button>
                )}
                {canUpload && (
                  <button
                    onClick={() => setForm(d)}
                    className="border-2 border-black px-2 py-1 text-xs font-bold"
                  >
                    Edit
                  </button>
                )}
                {canUpload && (
                  <button
                    aria-label="Archive"
                    title="Archive"
                    onClick={() => setArchive(d)}
                    className="border-2 border-black p-1.5 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      {form && (
        <DocForm
          doc={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {verify && <VerifyDialog doc={verify} onClose={() => setVerify(null)} />}
      {settings && <ReminderSettings onClose={() => setSettings(false)} />}
      {archive && (
        <ConfirmationDialog
          danger
          title="Archive document"
          message="Archive this document? It disappears from lists but the file is kept for audit."
          confirmLabel="Archive"
          busy={archiveMut.isPending}
          onConfirm={() => archiveMut.mutate(archive._id)}
          onClose={() => setArchive(null)}
        />
      )}
    </AppLayout>
  );
}
