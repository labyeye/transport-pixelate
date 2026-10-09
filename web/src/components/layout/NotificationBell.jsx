import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, CheckCircle2, Clock, Info } from "lucide-react";
import { get, post } from "@/services/api";

const timeAgo = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
};
const ICON = { critical: AlertTriangle, warning: AlertTriangle, info: Info };

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = useQuery({
    queryKey: ["notif-count"],
    queryFn: async () => (await get("/notifications/unread-count")).data.count,
    refetchInterval: 30000,
  });
  const list = useQuery({
    queryKey: ["notif-list"],
    queryFn: async () => (await get("/notifications", { limit: 20 })).data,
    enabled: open,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notif-count"] });
    qc.invalidateQueries({ queryKey: ["notif-list"] });
  };
  const read = useMutation({
    mutationFn: (id) => post(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => post("/notifications/read-all"),
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!open) return;
    const h = (e) =>
      ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const n = count.data ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${n ? `, ${n} unread` : ""}`}
        className="relative w-9 h-9 border-2 border-black bg-white flex items-center justify-center hover:bg-[#024BAB]/10 transition-colors"
      >
        <Bell className="w-[18px] h-[18px] text-black" />
        {n > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[#FA731C] border border-black rounded-full flex items-center justify-center text-[9px] font-bold text-white">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 max-w-[90vw] border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b-2 border-black bg-[#024BAB]">
            <span className="text-sm font-bold text-white flex items-center gap-2">
              <Bell className="w-4 h-4" /> Notifications
            </span>
            {n > 0 && (
              <button
                onClick={() => readAll.mutate()}
                className="text-[11px] text-white/80 hover:text-white font-medium"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {list.isLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground font-medium">
                Loading…
              </p>
            ) : !list.data?.length ? (
              <div className="flex flex-col items-center py-10 gap-2">
                <Bell className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-xs font-bold text-muted-foreground">
                  No notifications yet
                </p>
              </div>
            ) : (
              list.data.map((x) => {
                const Icon = ICON[x.severity] ?? Info;
                return (
                  <button
                    key={x._id}
                    onClick={() => {
                      if (!x.readAt) read.mutate(x._id);
                      if (x.link) {
                        setOpen(false);
                        navigate(x.link);
                      }
                    }}
                    className={`w-full text-left flex items-start gap-2 px-4 py-3 border-b border-black/10 last:border-0 hover:bg-[#024BAB]/5 ${x.readAt ? "" : "bg-[#024BAB]/[0.04]"}`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {x.readAt ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/40" />
                      ) : (
                        <Icon
                          className={`w-3.5 h-3.5 ${x.severity === "critical" ? "text-red-600" : x.severity === "warning" ? "text-orange-600" : "text-[#024BAB]"}`}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-black">{x.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {x.body}
                      </p>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70 font-medium mt-1">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(x.createdAt)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
