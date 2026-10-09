import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, UserX, Undo2 } from "lucide-react";
import { get, post } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import { inputCls } from "@/components/common/Field";

const LIVE = ["in_progress", "delayed"];
const PILL = {
  pending: "nb-tag-white",
  boarded: "nb-tag-blue",
  dropped: "nb-tag-green",
  missing: "nb-tag-red",
};
const EVENT_LABEL = {
  trip_created: "Trip created",
  driver_assigned: "Driver assigned",
  vehicle_assigned: "Vehicle assigned",
  trip_started: "Trip started",
  stop_reached: "Stop reached",
  passenger_boarded: "Boarded",
  passenger_dropped: "Dropped off",
  passenger_missing: "Marked missing",
  delay_reported: "Delay reported",
  breakdown_reported: "Breakdown reported",
  incident_reported: "Incident reported",
  note: "Note",
  trip_completed: "Trip completed",
  trip_cancelled: "Trip cancelled",
  trip_aborted: "Trip aborted",
  correction: "Correction",
};

export function Manifest({ trip }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const live = LIVE.includes(trip.status);
  const canOperate = can("trips:operate");
  const { data, isLoading, error } = useQuery({
    queryKey: ["manifest", trip._id],
    queryFn: async () => (await get(`/trips/${trip._id}/manifest`)).data,
  });
  const rec = useMutation({
    mutationFn: (b) => post(`/trips/${trip._id}/events`, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manifest", trip._id] });
      qc.invalidateQueries({ queryKey: ["events", trip._id] });
    },
    onError: (e) =>
      toast({
        title: "Not recorded",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  if (isLoading) return <p className="text-sm">Loading manifest…</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700 font-semibold">
        {errMsg(error)}
      </p>
    );
  const rows = data.passengers;
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground font-medium">
        No passengers are assigned to this route. Add them on the Passengers
        page.
      </p>
    );
  const c = data.counts;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider">
        {rows.length} passengers · {c.boarded ?? 0} on board · {c.dropped ?? 0}{" "}
        dropped · {c.missing ?? 0} missing
      </p>
      {!live && (
        <p className="text-xs text-muted-foreground font-medium">
          Boarding can only be recorded while the trip is in progress.
        </p>
      )}
      <ul className="border-2 border-black bg-white divide-y divide-black/10">
        {rows.map((p) => (
          <li
            key={p.passenger._id}
            className="px-3 py-2 flex flex-wrap items-center gap-2 justify-between"
          >
            <div>
              <p className="font-bold text-sm">
                {p.passenger.name}{" "}
                <span className={`nb-badge uppercase ml-1 ${PILL[p.status]}`}>
                  {p.status}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {p.pickupStop} → {p.dropStop}
              </p>
            </div>
            {live && canOperate && (
              <div className="flex gap-1">
                {p.status === "pending" && (
                  <>
                    <button
                      disabled={rec.isPending || !p.pickupSequence}
                      onClick={() =>
                        rec.mutate({
                          type: "passenger_boarded",
                          passenger: p.passenger._id,
                          stopSequence: p.pickupSequence,
                        })
                      }
                      className="border-2 border-black px-2 py-1 text-xs font-bold flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Board
                    </button>
                    <button
                      disabled={rec.isPending || !p.pickupSequence}
                      onClick={() =>
                        rec.mutate({
                          type: "passenger_missing",
                          passenger: p.passenger._id,
                          stopSequence: p.pickupSequence,
                        })
                      }
                      className="border-2 border-black px-2 py-1 text-xs font-bold flex items-center gap-1 text-red-600"
                    >
                      <UserX className="w-3 h-3" /> Missing
                    </button>
                  </>
                )}
                {p.status === "boarded" && (
                  <button
                    disabled={rec.isPending || !p.dropSequence}
                    onClick={() =>
                      rec.mutate({
                        type: "passenger_dropped",
                        passenger: p.passenger._id,
                        stopSequence: p.dropSequence,
                      })
                    }
                    className="border-2 border-black px-2 py-1 text-xs font-bold flex items-center gap-1"
                  >
                    <LogOut className="w-3 h-3" /> Drop off
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EventTimeline({ trip }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const [note, setNote] = useState("");
  const [type, setType] = useState("note");
  const [fixing, setFixing] = useState(null);
  const [reason, setReason] = useState("");
  const { data } = useQuery({
    queryKey: ["events", trip._id],
    queryFn: async () => (await get(`/trips/${trip._id}/events`)).data,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["events", trip._id] });
    qc.invalidateQueries({ queryKey: ["manifest", trip._id] });
    qc.invalidateQueries({ queryKey: ["trips"] });
  };
  const add = useMutation({
    mutationFn: () => post(`/trips/${trip._id}/events`, { type, notes: note }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: (e) =>
      toast({
        title: "Not recorded",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const fix = useMutation({
    mutationFn: () =>
      post(`/trips/${trip._id}/events/${fixing._id}/correct`, { reason }),
    onSuccess: () => {
      setFixing(null);
      setReason("");
      refresh();
    },
    onError: (e) =>
      toast({
        title: "Could not correct",
        description: errMsg(e),
        variant: "destructive",
      }),
  });
  const live = LIVE.includes(trip.status);
  return (
    <div className="space-y-3">
      {live && can("trips:operate") && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Event type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="border-2 border-black bg-white px-2 py-2 text-sm font-semibold"
          >
            <option value="note">Note</option>
            <option value="delay_reported">Delay</option>
            <option value="breakdown_reported">Breakdown</option>
            <option value="incident_reported">Incident</option>
          </select>
          <input
            aria-label="Details"
            placeholder="Details"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputCls} flex-1 min-w-40`}
          />
          <button
            disabled={add.isPending || !note.trim()}
            onClick={() => add.mutate()}
            className="border-2 border-black bg-[#024BAB] text-white px-3 py-2 text-sm font-bold disabled:opacity-50"
          >
            Record
          </button>
        </div>
      )}
      <ul className="border-2 border-black bg-white divide-y divide-black/10 max-h-72 overflow-auto">
        {(data ?? []).length === 0 && (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            No events yet.
          </li>
        )}
        {(data ?? []).map((e) => (
          <li
            key={e._id}
            className={`px-3 py-2 text-sm flex justify-between gap-2 ${e.superseded ? "opacity-50 line-through decoration-1" : ""}`}
          >
            <div>
              <b>{EVENT_LABEL[e.type]}</b>
              {e.passengerName ? ` · ${e.passengerName}` : ""}
              {e.stopSequence ? ` · stop ${e.stopSequence}` : ""}
              {e.notes ? (
                <p className="text-muted-foreground">{e.notes}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString("en-IN")} · {e.source}
                {e.superseded ? " · corrected" : ""}
              </p>
            </div>
            {can("trips:dispatch") &&
              !e.superseded &&
              e.type !== "correction" &&
              e.source !== "system" && (
                <button
                  title="Correct"
                  aria-label="Correct event"
                  onClick={() => setFixing(e)}
                  className="border-2 border-black p-1 h-fit"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
              )}
          </li>
        ))}
      </ul>
      {fixing && (
        <div className="border-2 border-black p-3 bg-[#FBBF24]/20 space-y-2">
          <p className="text-sm font-bold">
            Correct “{EVENT_LABEL[fixing.type]}”? The original stays in history,
            marked corrected.
          </p>
          <input
            aria-label="Reason"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setFixing(null)}
              className="border-2 border-black bg-white px-3 py-1.5 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              disabled={reason.trim().length < 3 || fix.isPending}
              onClick={() => fix.mutate()}
              className="border-2 border-black bg-[#EF4444] text-white px-3 py-1.5 text-sm font-bold disabled:opacity-50"
            >
              Apply correction
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
