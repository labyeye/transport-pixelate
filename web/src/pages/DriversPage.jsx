import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { DRIVER_STATUS, StatusBadge } from "@/components/common/StatusBadge";
import { ConfirmationDialog, Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, patch, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { formatDateOrDash } from "@/lib/utils";
const toDate = (d) => (d ? d.slice(0, 10) : "");
function DriverForm({ driver, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    staffRole: driver?.staffRole ?? "driver",
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    email: driver?.email ?? "",
    address: driver?.address ?? "",
    employmentType: driver?.employmentType ?? "employee",
    branch: driver?.branch ?? "",
    joiningDate: toDate(driver?.joiningDate),
    licenceNumber: driver?.licence?.number ?? "",
    licenceClass: driver?.licence?.class ?? "",
    licenceExpiry: toDate(driver?.licence?.expiryDate),
    ecName: driver?.emergencyContact?.name ?? "",
    ecPhone: driver?.emergencyContact?.phone ?? "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isDriver = f.staffRole === "driver";
  const save = useMutation({
    mutationFn: () => {
      const body = {
        staffRole: f.staffRole,
        name: f.name,
        phone: f.phone,
        email: f.email,
        address: f.address || undefined,
        employmentType: f.employmentType,
        branch: f.branch || undefined,
        joiningDate: f.joiningDate || undefined,
        licence:
          f.licenceNumber || f.licenceExpiry
            ? {
                number: f.licenceNumber || undefined,
                class: f.licenceClass || undefined,
                expiryDate: f.licenceExpiry || undefined,
              }
            : undefined,
        emergencyContact:
          f.ecName || f.ecPhone
            ? { name: f.ecName || undefined, phone: f.ecPhone || undefined }
            : undefined,
      };
      return driver
        ? put(`/drivers/${driver._id}`, body)
        : post("/drivers", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: driver ? "Profile updated" : "Profile created",
        variant: "success",
      });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal
      title={driver ? "Edit profile" : "Add driver / staff"}
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
          <Field label="Role">
            <select
              className={inputCls}
              value={f.staffRole}
              onChange={set("staffRole")}
            >
              <option value="driver">Driver</option>
              <option value="attendant">Attendant</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Full name" required>
            <input
              required
              className={inputCls}
              value={f.name}
              onChange={set("name")}
            />
          </Field>
          <Field label="Phone" required>
            <input
              required
              className={inputCls}
              value={f.phone}
              onChange={set("phone")}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              value={f.email}
              onChange={set("email")}
            />
          </Field>
          <Field label="Employment">
            <select
              className={inputCls}
              value={f.employmentType}
              onChange={set("employmentType")}
            >
              <option value="employee">Employee</option>
              <option value="contract">Contract</option>
            </select>
          </Field>
          <Field label="Joining date">
            <input
              type="date"
              className={inputCls}
              value={f.joiningDate}
              onChange={set("joiningDate")}
            />
          </Field>
          <Field label="Branch">
            <input
              className={inputCls}
              value={f.branch}
              onChange={set("branch")}
            />
          </Field>
          <Field label="Address">
            <input
              className={inputCls}
              value={f.address}
              onChange={set("address")}
            />
          </Field>
          <Field label="Emergency contact name">
            <input
              className={inputCls}
              value={f.ecName}
              onChange={set("ecName")}
            />
          </Field>
          <Field label="Emergency contact phone">
            <input
              className={inputCls}
              value={f.ecPhone}
              onChange={set("ecPhone")}
            />
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Licence number" required={isDriver}>
            <input
              required={isDriver}
              className={inputCls}
              value={f.licenceNumber}
              onChange={set("licenceNumber")}
            />
          </Field>
          <Field label="Licence class">
            <input
              className={inputCls}
              value={f.licenceClass}
              onChange={set("licenceClass")}
            />
          </Field>
          <Field label="Licence expiry" required={isDriver}>
            <input
              required={isDriver}
              type="date"
              className={inputCls}
              value={f.licenceExpiry}
              onChange={set("licenceExpiry")}
            />
          </Field>
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
            {save.isPending ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
export default function DriversPage() {
  const { can } = useAuth();
  const canWrite = can("drivers:write");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [form, setForm] = useState(null);
  const [archive, setArchive] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["drivers", page, search, status, role],
    queryFn: () =>
      get("/drivers", { page, limit: 15, search, status, staffRole: role }),
  });
  const setDriverStatus = useMutation({
    mutationFn: ({ id, s }) => patch(`/drivers/${id}/status`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drivers"] });
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
    mutationFn: (id) => del(`/drivers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Archived", variant: "success" });
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
  const filtered = !!(search || status || role);
  return (
    <AppLayout title="Drivers & Staff">
      <PageHeader
        title="Drivers & transport staff"
        subtitle="Licences, duty status and vehicle assignments"
        actions={
          canWrite && (
            <PrimaryButton onClick={() => setForm("new")}>
              <Plus className="w-4 h-4" /> Add driver / staff
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
          placeholder="Search by name, phone or licence"
        />
        <FilterSelect
          value={role}
          onChange={(s) => {
            setRole(s);
            setPage(1);
          }}
          all="All Roles"
          options={[
            { value: "driver", label: "Drivers" },
            { value: "attendant", label: "Attendants" },
            { value: "dispatcher", label: "Dispatchers" },
            { value: "other", label: "Other" },
          ]}
        />
        <FilterSelect
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          all="All Status"
          options={Object.entries(DRIVER_STATUS).map(([value, m]) => ({
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
            icon={Users}
            title={filtered ? "No one matches your filters" : "No drivers yet"}
            message={
              filtered
                ? "Try a different search or filter."
                : "Add drivers and attendants to start assigning vehicles and trips."
            }
            action={
              !filtered && canWrite ? (
                <PrimaryButton onClick={() => setForm("new")}>
                  Add driver / staff
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: "Name",
            cell: (r) => (
              <div>
                <p className="font-bold">{r.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {r.staffRole}
                </p>
              </div>
            ),
          },
          { header: "Phone", cell: (r) => r.phone },
          {
            header: "Licence",
            cell: (r) =>
              r.licence?.number ? (
                <div>
                  <p>{r.licence.number}</p>
                  <p
                    className={`text-xs ${r.licence.expiryDate && new Date(r.licence.expiryDate) < new Date() ? "text-red-600 font-bold" : "text-muted-foreground"}`}
                  >
                    Exp {formatDateOrDash(r.licence.expiryDate)}
                  </p>
                </div>
              ) : (
                "—"
              ),
          },
          {
            header: "Vehicle",
            cell: (r) => r.assignedVehicle?.registrationNumber ?? "—",
          },
          {
            header: "Status",
            cell: (r) => <StatusBadge meta={DRIVER_STATUS[r.status]} />,
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
                      <select
                        aria-label="Change status"
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          setDriverStatus.mutate({
                            id: r._id,
                            s: e.target.value,
                          })
                        }
                        className="border-2 border-black bg-white text-xs font-bold px-1 py-1.5"
                      >
                        <option value="">Set status…</option>
                        {Object.entries(DRIVER_STATUS).map(([k, m]) => (
                          <option key={k} value={k}>
                            {m.label}
                          </option>
                        ))}
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
        <DriverForm
          driver={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {archive && (
        <ConfirmationDialog
          danger
          title="Archive profile"
          message={`Archive ${archive.name}? They will no longer be assignable. History is kept.`}
          confirmLabel="Archive"
          busy={archiveMut.isPending}
          onConfirm={() => archiveMut.mutate(archive._id)}
          onClose={() => setArchive(null)}
        />
      )}
    </AppLayout>
  );
}
