import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";

const KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "MONGO_URI",
  "ALLOWED_ORIGINS",
];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of KEYS)
    saved[k] === undefined
      ? delete process.env[k]
      : (process.env[k] = saved[k]);
});

const good = "a".repeat(20) + "9f3b7c1d4e8a" + "Q".repeat(10);
const set = (o) =>
  Object.assign(process.env, {
    NODE_ENV: "production",
    MONGO_URI: "mongodb://x/y",
    ALLOWED_ORIGINS: "https://app.example.org",
    JWT_SECRET: good,
    JWT_REFRESH_SECRET: good + "2",
    ...o,
  });

describe("startup configuration", () => {
  it("accepts strong, distinct secrets in production", () => {
    set({});
    expect(loadEnv().isProd).toBe(true);
  });
  it("refuses placeholder, short or identical secrets and a missing CORS list in production", () => {
    set({ JWT_SECRET: "change-me-long-random" });
    expect(() => loadEnv()).toThrow(/JWT_SECRET is too weak/);
    set({ JWT_SECRET: good, JWT_REFRESH_SECRET: "short" });
    expect(() => loadEnv()).toThrow(/JWT_REFRESH_SECRET is too weak/);
    set({ JWT_REFRESH_SECRET: good });
    expect(() => loadEnv()).toThrow(/must be different/);
    set({});
    delete process.env.ALLOWED_ORIGINS;
    expect(() => loadEnv()).toThrow(/ALLOWED_ORIGINS/);
  });
  it("is lenient outside production so local development stays easy", () => {
    set({
      NODE_ENV: "development",
      JWT_SECRET: "dev",
      JWT_REFRESH_SECRET: "dev2",
    });
    expect(() => loadEnv()).not.toThrow();
  });
  it("always requires the core variables", () => {
    set({ NODE_ENV: "development" });
    delete process.env.MONGO_URI;
    expect(() => loadEnv()).toThrow(/MONGO_URI/);
  });
});
