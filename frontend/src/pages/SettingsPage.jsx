import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { DataTable, EmptyState } from "@/components/common/DataTable";
import { FilterSelect, SearchInput } from "@/components/common/SearchInput";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { get, patch, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";

const ROLES = [
  "owner",
  "admin",
  "dispatcher",
  "accountant",
  "driver",
  "attendant",
  "viewer",
];
const ROLE_NOTE = {
  owner: "Everything, including other owners and admins",
  admin: "Everything except managing owners/admins",
  dispatcher: "Routes, trips, dispatch, tracking, maintenance",
  accountant: "Fuel, expenses, costs and reports",
  driver: "Own trips, requests, location sharing",
  attendant: "Own trips, manifest, requests",
  viewer: "Read-only",
};
const MODULES = [
  ["fuelExpenses", "Fuel & expenses"],
  ["passengerManifest", "Passenger manifests"],
  ["billing", "Transport fees & billing"],
  ["parentAccess", "Parent access (not built yet)"],
];

function ErrorBox({ children }) {
  return (
    <div
      role="alert"
      className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700"
    >
      {children}
    </div>
  );
}

function LinkResult({ result, onClose, title }) {
  const { toast } = useToast();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm font-semibold mb-2">
        {result.emailed
          ? "The link was also emailed to them."
          : `Email wasn't sent${result.emailNote ? ` (${result.emailNote})` : ""}. Share this link with them yourself.`}
      </p>
      <div className="flex gap-2">
        <code className="font-mono text-xs break-all border-2 border-black p-2 bg-white flex-1">
          {result.link}
        </code>
        <button
          aria-label="Copy link"
          onClick={() => {
            navigator.clipboard?.writeText(result.link);
            toast({ title: "Copied", variant: "success" });
          }}
          className="border-2 border-black p-2"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground font-medium mt-2">
        The link is single-use and is shown only now.
      </p>
      <div className="flex justify-end mt-4">
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      </div>
    </Modal>
  );
}

function UserForm({ user, onClose, onInvite }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const drivers = useQuery({
    queryKey: ["drivers", "all"],
    queryFn: async () => (await get("/drivers", { limit: 100 })).data,
  });
  const [f, setF] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    role: user?.role ?? "dispatcher",
    driver: "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const allowed =
    me.role === "owner"
      ? ROLES
      : ROLES.filter((r) => !["owner", "admin"].includes(r));
  const save = useMutation({
    mutationFn: () =>
      user
        ? put(`/users/${user._id}`, {
            name: f.name,
            phone: f.phone || "",
            ...(f.role !== user.role && { role: f.role }),
          })
        : post("/users", {
            name: f.name,
            email: f.email,
            phone: f.phone || undefined,
            role: f.role,
            driver: f.driver || undefined,
          }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      if (r.invite) onInvite(r.invite);
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title={user ? "Edit user" : "Add user"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
        className="space-y-3"
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Name" required>
          <input
            required
            className={inputCls}
            value={f.name}
            onChange={set("name")}
          />
        </Field>
        <Field label="Email" required>
          <input
            required
            disabled={!!user}
            type="email"
            className={inputCls}
            value={f.email}
            onChange={set("email")}
          />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={f.role} onChange={set("role")}>
            {(allowed.includes(f.role) ? allowed : [f.role, ...allowed]).map(
              (r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ),
            )}
          </select>
        </Field>
        <p className="text-xs text-muted-foreground font-medium">
          {ROLE_NOTE[f.role]}
        </p>
        {!user && ["driver", "attendant"].includes(f.role) && (
          <Field label="Link to staff profile (so they can use the mobile app)">
            <select
              className={inputCls}
              value={f.driver}
              onChange={set("driver")}
            >
              <option value="">— Link later —</option>
              {drivers.data
                ?.filter((d) => !d.user)
                .map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name} · {d.staffRole}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {!user && (
          <p className="text-xs text-muted-foreground font-medium">
            They'll receive a link to set their own password. Nobody, including
            you, ever sees it.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
          >
            Cancel
          </button>
          <PrimaryButton disabled={save.isPending}>
            {user ? "Save" : "Create & invite"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function LinkDriver({ user, onClose }) {
  const qc = useQueryClient();
  const drivers = useQuery({
    queryKey: ["drivers", "all"],
    queryFn: async () => (await get("/drivers", { limit: 100 })).data,
  });
  const [driver, setDriver] = useState(user.driver?._id ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      put(`/users/${user._id}/driver-link`, { driver: driver || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title={`Staff profile · ${user.name}`} onClose={onClose}>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Field label="Linked driver / attendant profile">
        <select
          className={inputCls}
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
        >
          <option value="">— Not linked —</option>
          {drivers.data
            ?.filter((d) => !d.user || d._id === user.driver?._id)
            .map((d) => (
              <option key={d._id} value={d._id}>
                {d.name} · {d.staffRole}
              </option>
            ))}
        </select>
      </Field>
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

function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [form, setForm] = useState(null);
  const [link, setLink] = useState(null);
  const [linkDriver, setLinkDriver] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["users", page, search, role],
    queryFn: () => get("/users", { page, limit: 15, search, role }),
  });
  const status = useMutation({
    mutationFn: (u) =>
      patch(`/users/${u._id}/status`, {
        status: u.status === "active" ? "inactive" : "active",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) =>
      toast({
        title: "Not changed",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const reset = useMutation({
    mutationFn: (u) => post(`/users/${u._id}/reset-link`),
    onSuccess: (r) => setLink(r.data),
    onError: (e) =>
      toast({
        title: "Failed",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name or email"
        />
        <FilterSelect
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          all="All roles"
          options={ROLES.map((r) => ({ value: r, label: r }))}
        />
        <PrimaryButton onClick={() => setForm("new")}>
          <Plus className="w-4 h-4" /> Add user
        </PrimaryButton>
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data ?? []}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={UserCog}
            title="No users match"
            message="Try another search."
          />
        }
        columns={[
          {
            header: "User",
            cell: (u) => (
              <div>
                <p className="font-bold">
                  {u.name}
                  {u._id === me.id && (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
            ),
          },
          {
            header: "Role",
            cell: (u) => (
              <span className="capitalize font-semibold">{u.role}</span>
            ),
          },
          {
            header: "Staff profile",
            cell: (u) =>
              u.driver?.name ?? (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            header: "Last sign-in",
            cell: (u) =>
              u.lastLoginAt ? (
                new Date(u.lastLoginAt).toLocaleString("en-IN")
              ) : (
                <span className="text-muted-foreground">Never</span>
              ),
          },
          {
            header: "Status",
            cell: (u) => (
              <span
                className={`nb-badge uppercase ${u.status === "active" ? "nb-tag-green" : "nb-tag-white"}`}
              >
                {u.status}
              </span>
            ),
          },
          {
            header: "Actions",
            cell: (u) => (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setForm(u)}
                  className="border-2 border-black px-2 py-1 text-xs font-bold"
                >
                  Edit
                </button>
                {["driver", "attendant"].includes(u.role) && (
                  <button
                    onClick={() => setLinkDriver(u)}
                    className="border-2 border-black px-2 py-1 text-xs font-bold"
                  >
                    Profile
                  </button>
                )}
                {u.status === "active" && (
                  <button
                    aria-label="Send reset link"
                    title="Password reset link"
                    onClick={() => reset.mutate(u)}
                    className="border-2 border-black p-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                )}
                {u._id !== me.id && (
                  <button
                    onClick={() => status.mutate(u)}
                    className="border-2 border-black px-2 py-1 text-xs font-bold"
                  >
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      {form && (
        <UserForm
          user={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
          onInvite={(inv) => setLink(inv)}
        />
      )}
      {link && (
        <LinkResult
          title="Share this link"
          result={link}
          onClose={() => setLink(null)}
        />
      )}
      {linkDriver && (
        <LinkDriver user={linkDriver} onClose={() => setLinkDriver(null)} />
      )}
    </div>
  );
}

function Organization() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => (await get("/settings/organization")).data,
  });
  const [f, setF] = useState(null);
  const [error, setError] = useState("");
  const v = f ?? data;
  const save = useMutation({
    mutationFn: () =>
      put("/settings/organization", {
        name: v.name,
        category: v.category,
        currency: v.currency,
        timezone: v.timezone,
        gpsRetentionDays: Number(v.gpsRetentionDays),
        modules: v.modules,
      }),
    onSuccess: () => {
      setF(null);
      setError("");
      ["org-settings", "dashboard", "report-catalog"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: "Settings saved", variant: "success" });
    },
    onError: (e) => setError(errMsg(e)),
  });
  if (!v)
    return (
      <div className="h-40 border-2 border-black bg-white animate-pulse" />
    );
  const set = (k, val) => setF({ ...v, [k]: val });
  return (
    <div className="space-y-4 max-w-2xl">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="border-2 border-black bg-white p-4 grid sm:grid-cols-2 gap-3">
        <Field label="Organization name">
          <input
            className={inputCls}
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select
            className={inputCls}
            value={v.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {["school", "employee", "institution", "contractor", "other"].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Timezone (IANA)">
          <input
            className={inputCls}
            value={v.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="Asia/Kolkata"
          />
        </Field>
        <Field label="Currency">
          <input
            className={inputCls}
            maxLength={3}
            value={v.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Keep GPS history (days)">
          <input
            type="number"
            min={7}
            max={730}
            className={inputCls}
            value={v.gpsRetentionDays}
            onChange={(e) => set("gpsRetentionDays", e.target.value)}
          />
        </Field>
      </div>
      <div className="border-2 border-black bg-white p-4">
        <p className="font-bold mb-2">Modules</p>
        {MODULES.map(([k, l]) => (
          <label
            key={k}
            className="flex items-center gap-2 text-sm font-semibold py-1"
          >
            <input
              type="checkbox"
              checked={!!v.modules[k]}
              onChange={(e) =>
                set("modules", { ...v.modules, [k]: e.target.checked })
              }
            />{" "}
            {l}
          </label>
        ))}
        <p className="text-xs text-muted-foreground font-medium mt-2">
          Turning a module off hides it and blocks its API; existing records are
          kept.
        </p>
      </div>
      <PrimaryButton
        disabled={!f || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save changes"}
      </PrimaryButton>
    </div>
  );
}

function Security() {
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState({ name: user.name, phone: "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [error, setError] = useState("");
  const saveProfile = useMutation({
    mutationFn: () =>
      put("/auth/profile", {
        name: profile.name,
        phone: profile.phone || undefined,
      }),
    onSuccess: () => toast({ title: "Profile saved", variant: "success" }),
    onError: (e) => setError(errMsg(e)),
  });
  const changePw = useMutation({
    mutationFn: () =>
      post("/auth/change-password", { current: pw.current, next: pw.next }),
    onSuccess: async () => {
      toast({
        title: "Password changed. Please sign in again.",
        variant: "success",
      });
      await logout();
    },
    onError: (e) => setError(errMsg(e)),
  });
  const all = useMutation({
    mutationFn: () => post("/auth/logout-all"),
    onSuccess: () => logout(),
  });
  return (
    <div className="space-y-4 max-w-xl">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="border-2 border-black bg-white p-4 space-y-3">
        <p className="font-bold">My profile</p>
        <Field label="Name">
          <input
            className={inputCls}
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
        </Field>
        <PrimaryButton
          disabled={saveProfile.isPending}
          onClick={() => {
            setError("");
            saveProfile.mutate();
          }}
        >
          Save profile
        </PrimaryButton>
      </div>
      <div className="border-2 border-black bg-white p-4 space-y-3">
        <p className="font-bold">Change password</p>
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            className={inputCls}
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
        </Field>
        <Field label="New password (min 8)">
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
        </Field>
        <PrimaryButton
          disabled={changePw.isPending || pw.next.length < 8 || !pw.current}
          onClick={() => {
            setError("");
            changePw.mutate();
          }}
        >
          Change password
        </PrimaryButton>
      </div>
      <div className="border-2 border-black bg-white p-4">
        <p className="font-bold">Sessions</p>
        <p className="text-xs text-muted-foreground font-medium my-2">
          Sign out of every browser and phone where you're signed in.
        </p>
        <button
          onClick={() => all.mutate()}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["audit", page, action],
    queryFn: () =>
      get("/settings/audit-logs", {
        page,
        limit: 20,
        action: action || undefined,
      }),
  });
  return (
    <div>
      <div className="mb-3">
        <select
          aria-label="Area"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="border-2 border-black bg-white px-3 py-2 text-sm font-semibold"
        >
          <option value="">All activity</option>
          {[
            "auth",
            "user",
            "vehicle",
            "driver",
            "route",
            "trip",
            "request",
            "document",
            "expense",
            "maintenance",
            "organization",
            "report",
          ].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data ?? []}
        meta={data?.meta}
        onPage={setPage}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No activity yet"
            message="Important actions are recorded here."
          />
        }
        columns={[
          {
            header: "When",
            cell: (l) => new Date(l.at).toLocaleString("en-IN"),
          },
          {
            header: "Who",
            cell: (l) =>
              l.actor ? (
                <div>
                  <p className="font-semibold">{l.actor.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.actor.email}
                  </p>
                </div>
              ) : (
                <span className="text-muted-foreground">System</span>
              ),
          },
          {
            header: "Action",
            cell: (l) => <span className="font-mono text-xs">{l.action}</span>,
          },
          { header: "Record", cell: (l) => l.entity ?? "—" },
          {
            header: "IP",
            cell: (l) => (
              <span className="font-mono text-xs">{l.ip ?? "—"}</span>
            ),
          },
        ]}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    ...(can("settings:write") ? [["org", "Organization"]] : []),
    ...(can("users:write") ? [["users", "Users & roles"]] : []),
    ["security", "My account"],
    ...(can("settings:write") ? [["audit", "Audit log"]] : []),
  ];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <AppLayout title="Settings">
      <PageHeader
        title="Settings"
        subtitle="Organization, people and security"
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-2 border-black px-4 py-1.5 text-sm font-bold ${tab === k ? "bg-[#024BAB] text-white" : "bg-white"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "org" ? (
        <Organization />
      ) : tab === "users" ? (
        <Users />
      ) : tab === "audit" ? (
        <AuditLog />
      ) : (
        <Security />
      )}
    </AppLayout>
  );
}
