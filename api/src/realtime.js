import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { User } from "./models/User.js";
import { can } from "./utils/permissions.js";

let io = null;

/** Attach Socket.IO. Connections must present a valid access token; each user joins only their org room. */
export function attachRealtime(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });
  io.use(async (socket, next) => {
    try {
      const claims = jwt.verify(
        socket.handshake.auth?.token ?? "",
        process.env.JWT_SECRET,
      );
      const user = await User.findById(claims.id).select(
        "organization role status",
      );
      if (
        !user ||
        user.status !== "active" ||
        String(user.organization) !== claims.org
      )
        return next(new Error("unauthorized"));
      if (!can(user.role, "trips:read")) return next(new Error("forbidden"));
      socket.data.org = String(user.organization);
      socket.data.role = user.role;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    socket.join(`org:${socket.data.org}`);
    // Location events are only for roles that may see tracking.
    if (can(socket.data.role, "tracking:read"))
      socket.join(`org:${socket.data.org}:tracking`);
  });
  return io;
}

export function emitToOrg(org, event, payload, { tracking = false } = {}) {
  if (!io) return;
  io.to(tracking ? `org:${org}:tracking` : `org:${org}`).emit(event, payload);
}

export const closeRealtime = () => io?.close();
