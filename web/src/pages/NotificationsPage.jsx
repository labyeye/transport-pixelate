import { WhatsAppIcon } from "@/components/common/BrandImages";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCircle2, Send, XCircle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, PrimaryButton } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { Modal } from "@/components/common/Modal";
import { Field, inputCls } from "@/components/common/Field";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { del, get, post, put } from "@/services/api";
import { errMsg } from "@/lib/errors";

const EXT = ["email", "sms", "whatsapp", "push"];
const CH_LABEL = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  push: "Push",
};
const SEV = {
  info: "nb-tag-blue",
  warning: "nb-tag-yellow",
  critical: "nb-tag-red",
};
const DELIVERY = {
  sent: "nb-tag-green",
  queued: "nb-tag-yellow",
  failed: "nb-tag-red",
  skipped: "nb-tag-white",
};

function Preferences() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: async () => (await get("/notifications/preferences")).data,
  });
  const [phone, setPhone] = useState(null);
  const save = useMutation({
    mutationFn: (b) => put("/notifications/preferences", b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      toast({ title: "Preferences saved", variant: "success" });
    },
    onError: (e) =>
      toast({
        title: "Not saved",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  if (!data)
    return (
      <div className="h-24 border-2 border-black bg-white animate-pulse" />
    );
  const muted = data.mutedChannels;
  return (
    <div className="border-2 border-black bg-white p-4 space-y-3 mb-5">
      <p className="font-bold">My preferences</p>
      <p className="text-xs text-muted-foreground font-medium">
        In-app notifications can't be turned off. Choose which external channels
        may contact you ({data.email}).
      </p>
      <div className="flex flex-wrap gap-3">
        {["email", "sms", "whatsapp"].map((c) => (
          <label
            key={c}
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <input
              type="checkbox"
              checked={!muted.includes(c)}
              onChange={(e) =>
                save.mutate({
                  mutedChannels: e.target.checked
                    ? muted.filter((x) => x !== c)
                    : [...muted, c],
                })
              }
            />{" "}
            {c === "whatsapp" && <WhatsAppIcon />}
            {CH_LABEL[c]}
          </label>
        ))}
      </div>
      <div className="flex gap-2 items-end max-w-sm">
        <Field label="My phone (for SMS / WhatsApp)">
          <input
            className={inputCls}
            value={phone ?? data.phone ?? ""}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91…"
          />
        </Field>
        <PrimaryButton
          disabled={phone === null || save.isPending}
          onClick={() => save.mutate({ phone })}
        >
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}

function Events() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["notif-settings"],
    queryFn: async () => (await get("/notifications/settings")).data,
  });
  const save = useMutation({
    mutationFn: (body) => put("/notifications/settings", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-settings"] }),
    onError: (e) =>
      toast({
        title: "Not saved",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const [testing, setTesting] = useState(null);
  const test = useMutation({
    mutationFn: (channel) =>
      post("/notifications/test", { channel }).catch((e) => ({
        data: { status: "failed", error: errMsg(e) },
      })),
    onSuccess: (r, ch) => setTesting({ channel: ch, ...r.data }),
  });
  if (!data)
    return (
      <div className="h-40 border-2 border-black bg-white animate-pulse" />
    );
  const setEvent = (event, patch) =>
    save.mutate({ events: { [event]: patch } });
  return (
    <div className="space-y-5">
      <div className="border-2 border-black bg-white">
        <div className="px-4 py-3 border-b-2 border-black bg-[#024BAB]/5 font-bold">
          Channels
        </div>
        <ul className="divide-y divide-black/10">
          {data.channels.map((c) => (
            <li
              key={c.key}
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <p className="font-bold text-sm">{c.label}</p>
                <p className="text-xs text-muted-foreground font-medium">
                  {!c.implemented
                    ? "Not implemented yet"
                    : c.configured
                      ? "Server credentials present — unverified until you send a test"
                      : "No credentials on the server (set the environment variables to enable)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!c.configured || test.isPending}
                  onClick={() => test.mutate(c.key)}
                  className="border-2 border-black px-2 py-1 text-xs font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Test
                </button>
                <label className="flex items-center gap-1.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    disabled={!c.configured}
                    checked={c.enabled}
                    onChange={(e) =>
                      save.mutate({
                        channels: { [c.key]: { enabled: e.target.checked } },
                      })
                    }
                  />{" "}
                  Enabled
                </label>
              </div>
            </li>
          ))}
          <li className="px-4 py-3 flex justify-between items-center">
            <span className="font-bold text-sm">In-app</span>
            <button
              onClick={() => test.mutate("in_app")}
              className="border-2 border-black px-2 py-1 text-xs font-bold flex items-center gap-1"
            >
              <Send className="w-3 h-3" /> Test
            </button>
          </li>
        </ul>
      </div>
      <div className="border-2 border-black bg-white overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-black bg-[#024BAB]/5">
              {[
                "Event",
                "On",
                "In-app",
                ...EXT.map((c) => CH_LABEL[c]),
                "Also sent to roles",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr
                key={e.event}
                className="border-b border-black/10 last:border-0"
              >
                <td className="px-3 py-2">
                  <span className="font-bold">{e.label}</span>{" "}
                  <span
                    className={`nb-badge uppercase ml-1 ${SEV[e.severity]}`}
                  >
                    {e.severity}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${e.label} enabled`}
                    checked={e.enabled}
                    onChange={(ev) =>
                      setEvent(e.event, { enabled: ev.target.checked })
                    }
                  />
                </td>
                {["in_app", ...EXT].map((c) => {
                  const ch =
                    c === "in_app"
                      ? { enabled: true, configured: true }
                      : data.channels.find((x) => x.key === c);
                  const usable =
                    c === "in_app" || (ch.configured && ch.enabled);
                  return (
                    <td key={c} className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${e.label} ${c}`}
                        disabled={!usable}
                        checked={e.channels.includes(c)}
                        onChange={(ev) =>
                          setEvent(e.event, {
                            channels: ev.target.checked
                              ? [...new Set([...e.channels, c])]
                              : e.channels.filter((x) => x !== c),
                          })
                        }
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-xs">
                  <select
                    multiple
                    aria-label={`${e.label} roles`}
                    value={e.roles}
                    onChange={(ev) =>
                      setEvent(e.event, {
                        roles: [...ev.target.selectedOptions].map(
                          (o) => o.value,
                        ),
                      })
                    }
                    className="border-2 border-black bg-white text-xs h-16"
                  >
                    {data.roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground font-medium">
        Assigned drivers and requesters are always notified on the channels
        ticked for the event. Greyed channels need working server credentials
        and to be enabled above. Hold Ctrl/Cmd to select several roles.
      </p>
      {testing && (
        <Modal
          title={`${CH_LABEL[testing.channel]} test`}
          onClose={() => setTesting(null)}
        >
          <div className="flex items-start gap-2 text-sm font-semibold">
            {testing.status === "sent" ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
            ) : testing.status === "skipped" ? (
              <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <div>
              <p className="capitalize">{testing.status}</p>
              {testing.error && (
                <p className="text-muted-foreground font-medium">
                  {testing.error}
                </p>
              )}
              {testing.status === "sent" && (
                <p className="text-muted-foreground font-medium">
                  The provider accepted the message. Check the inbox/phone to
                  confirm it arrived.
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <PrimaryButton onClick={() => setTesting(null)}>
              Close
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Templates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["notif-templates"],
    queryFn: async () => (await get("/notifications/templates")).data,
  });
  const [edit, setEdit] = useState(null);
  const save = useMutation({
    mutationFn: () =>
      put(`/notifications/templates/${edit.event}/${edit.channel}`, {
        subject: edit.subject,
        body: edit.body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-templates"] });
      toast({ title: "Template saved", variant: "success" });
      setEdit(null);
    },
    onError: (e) =>
      toast({
        title: "Not saved",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const reset = useMutation({
    mutationFn: (t) => del(`/notifications/templates/${t.event}/${t.channel}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-templates"] });
      setEdit(null);
    },
  });
  const rows = (data ?? [])
    .filter((t) => ["in_app", "email", "sms"].includes(t.channel))
    .map((t) => ({ ...t, _id: `${t.event}:${t.channel}` }));
  return (
    <>
      <DataTable
        loading={!data}
        rows={rows}
        onPage={() => {}}
        empty={null}
        columns={[
          {
            header: "Event",
            cell: (t) => (
              <span className="font-bold">{t.event.replace(/_/g, " ")}</span>
            ),
          },
          { header: "Channel", cell: (t) => CH_LABEL[t.channel] },
          {
            header: "Message",
            cell: (t) => (
              <div className="max-w-md">
                <p className="font-semibold truncate">{t.subject}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {t.body}
                </p>
              </div>
            ),
          },
          {
            header: "",
            cell: (t) => (
              <div className="flex gap-1 items-center">
                {t.custom && (
                  <span className="nb-badge nb-tag-purple">Custom</span>
                )}
                <button
                  onClick={() => setEdit(t)}
                  className="border-2 border-black px-2 py-1 text-xs font-bold"
                >
                  Edit
                </button>
              </div>
            ),
          },
        ]}
      />
      {edit && (
        <Modal
          title={`${edit.event.replace(/_/g, " ")} · ${CH_LABEL[edit.channel]}`}
          onClose={() => setEdit(null)}
          wide
        >
          <div className="space-y-3">
            <Field label="Subject / title">
              <input
                className={inputCls}
                value={edit.subject}
                onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
              />
            </Field>
            <Field label="Message">
              <textarea
                rows={4}
                className={inputCls}
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted-foreground font-medium">
              Use {"{{variables}}"} such as {"{{tripNumber}}"}, {"{{route}}"},{" "}
              {"{{date}}"}, {"{{time}}"}, {"{{reason}}"}, {"{{vehicle}}"}.
              Messages are plain text.
            </p>
          </div>
          <div className="flex justify-between mt-4">
            <button
              disabled={!edit.custom}
              onClick={() => reset.mutate(edit)}
              className="border-2 border-black bg-white px-3 py-2 text-sm font-bold disabled:opacity-40"
            >
              Reset to default
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setEdit(null)}
                className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <PrimaryButton
                disabled={save.isPending || edit.body.trim().length < 3}
                onClick={() => save.mutate()}
              >
                Save
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Deliveries() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["deliveries", page, status],
    queryFn: () =>
      get("/notifications/deliveries", { page, limit: 15, status }),
  });
  return (
    <>
      <div className="mb-3">
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="border-2 border-black bg-white px-3 py-2 text-sm font-semibold"
        >
          <option value="">All status</option>
          {Object.keys(DELIVERY).map((s) => (
            <option key={s} value={s}>
              {s}
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
          <div className="border-2 border-dashed border-black/40 bg-white p-8 text-center text-sm font-medium text-muted-foreground">
            No external messages yet. In-app notifications aren't listed here.
          </div>
        }
        columns={[
          {
            header: "When",
            cell: (d) => new Date(d.createdAt).toLocaleString("en-IN"),
          },
          { header: "Event", cell: (d) => d.event?.replace(/_/g, " ") },
          { header: "Channel", cell: (d) => CH_LABEL[d.channel] },
          {
            header: "To",
            cell: (d) => <span className="font-mono text-xs">{d.to}</span>,
          },
          {
            header: "Status",
            cell: (d) => (
              <div>
                <span className={`nb-badge uppercase ${DELIVERY[d.status]}`}>
                  {d.status}
                </span>
                {d.error && (
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    {d.error}
                  </p>
                )}
              </div>
            ),
          },
          { header: "Tries", cell: (d) => d.attempts },
        ]}
      />
    </>
  );
}

export default function NotificationsPage() {
  const { can } = useAuth();
  const admin = can("settings:write");
  const [tab, setTab] = useState("events");
  return (
    <AppLayout title="Notifications">
      <PageHeader
        title="Notifications"
        subtitle="What gets sent, to whom, and how"
      />
      <Preferences />
      {admin && (
        <>
          <div className="flex gap-2 mb-4">
            {[
              ["events", "Events & channels"],
              ["templates", "Templates"],
              ["log", "Delivery log"],
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
          {tab === "events" ? (
            <Events />
          ) : tab === "templates" ? (
            <Templates />
          ) : (
            <Deliveries />
          )}
        </>
      )}
      {!admin && (
        <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
          <Bell className="w-4 h-4" /> Your notifications appear under the bell
          in the top bar.
        </p>
      )}
    </AppLayout>
  );
}
