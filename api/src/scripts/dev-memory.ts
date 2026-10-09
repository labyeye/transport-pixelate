// Development only: runs the API against an in-memory MongoDB (data is lost on exit).
import http from "http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app";

(async () => {
  process.env.JWT_SECRET ??= "dev-secret-dev-secret";
  process.env.JWT_REFRESH_SECRET ??= "dev-refresh-dev-refresh";
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  http.createServer(createApp(["http://localhost:5175"])).listen(5100, () => console.log("DEV (in-memory DB) API on :5100"));
})();
