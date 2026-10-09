import http from "http";
import mongoose from "mongoose";
import { loadEnv } from "./config/env";
import { createApp } from "./app";

async function main() {
  const env = loadEnv();
  await mongoose.connect(env.mongoUri);
  const server = http.createServer(createApp(env.allowedOrigins));
  server.listen(env.port, () => console.log(`Nest Transport API on :${env.port}`));
}
main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
