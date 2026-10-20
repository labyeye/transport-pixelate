import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { get, tokens } from "@/services/api";

const URL = import.meta.env.VITE_SOCKET_URL ?? window.location.origin;

/** Subscribes to org-scoped realtime events. Reports connection state so the UI never pretends to be live. */
export function useLiveSocket(handlers) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket = io(URL, {
      auth: (cb) => cb({ token: tokens.getAccess() }),
      transports: ["websocket"],
      reconnectionDelayMax: 10000,
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    // Expired access token: any API call refreshes it, then the socket retries with the new one.
    socket.on("connect_error", () => {
      setConnected(false);
      get("/auth/me").catch(() => {});
    });
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return connected;
}
