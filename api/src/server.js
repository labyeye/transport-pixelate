import http from "http";
import mongoose from "mongoose";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { startNotificationJobs } from "./modules/notifications/jobs.js";
import { attachRealtime } from "./realtime.js";
import { Organization } from "./models/Organization.js";
import { purgeOldPings } from "./modules/tracking/tracking.service.js";
async function main() {
  const env = loadEnv();
  await mongoose.connect(env.mongoUri);
  const server = http.createServer(createApp(env.allowedOrigins));
  startNotificationJobs();
  attachRealtime(server, env.allowedOrigins);
  // Enforce each organization's GPS retention window once an hour.
  setInterval(
    () =>
      purgeOldPings(Organization).catch((e) =>
        console.error("[purge]", e.message),
      ),
    3600_000,
  ).unref();
  server.listen(env.port, () =>
    console.log(`Nest Transport API on :${env.port}`),
  );
}
main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
