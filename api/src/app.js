import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import authRoutes from "./modules/auth/auth.routes.js";
import vehicleRoutes from "./modules/vehicles/vehicles.routes.js";
import driverRoutes from "./modules/drivers/drivers.routes.js";
import routeRoutes from "./modules/routes/routes.routes.js";
import tripRoutes from "./modules/trips/trips.routes.js";
import scheduleRoutes from "./modules/trips/schedules.routes.js";
import eventRoutes from "./modules/events/events.routes.js";
import passengerRoutes from "./modules/passengers/passengers.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
export function createApp(allowedOrigins) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") app.use(morgan("tiny"));
  app.use(
    "/api/v1",
    rateLimit({
      windowMs: 60_000,
      limit: process.env.NODE_ENV === "test" ? 10_000 : 300,
    }),
  );
  app.get("/api/v1/health", (_req, res) => res.json({ success: true }));
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/vehicles", vehicleRoutes);
  app.use("/api/v1/drivers", driverRoutes);
  app.use("/api/v1/routes", routeRoutes);
  app.use("/api/v1/trips", tripRoutes);
  app.use("/api/v1/trips", eventRoutes);
  app.use("/api/v1/passengers", passengerRoutes);
  app.use("/api/v1/trip-schedules", scheduleRoutes);
  app.use("/api/v1/dashboard", dashboardRoutes);
  app.use((_req, res) =>
    res.status(404).json({ success: false, message: "Not found" }),
  );
  app.use(errorHandler);
  return app;
}
