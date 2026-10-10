import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { buildOpenApi, collectRoutes } from "../scripts/openapi.js";

// A guard against accidentally shipping an unauthenticated or permission-less endpoint.
const app = createApp(["http://localhost"]);
const routes = collectRoutes(app).filter((r) => r.path.startsWith("/api/v1"));
const id = (r) => `${r.method} ${r.path}`;

const PUBLIC = new Set([
  "GET /api/v1/health",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/forgot-password",
  "POST /api/v1/auth/reset-password",
  "POST /api/v1/tracking/ingest", // device key
  "POST /api/v1/billing/razorpay/webhook", // HMAC signature
]);

// Signed-in routes that carry no permission in the route table. Each was reviewed:
// own-account actions, or the permission depends on the record type and is checked inside the handler.
const SELF_SCOPED = new Set([
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/change-password",
  "POST /api/v1/auth/logout-all",
  "PUT /api/v1/auth/profile",
  "GET /api/v1/documents",
  "POST /api/v1/documents",
  "GET /api/v1/documents/{id}",
  "PUT /api/v1/documents/{id}",
  "DELETE /api/v1/documents/{id}",
  "GET /api/v1/documents/{id}/file",
  "GET /api/v1/notifications",
  "GET /api/v1/notifications/unread-count",
  "POST /api/v1/notifications/read-all",
  "POST /api/v1/notifications/{id}/read",
  "GET /api/v1/notifications/preferences",
  "PUT /api/v1/notifications/preferences",
  "GET /api/v1/reports",
  "GET /api/v1/reports/{key}",
  "GET /api/v1/reports/{key}/export.csv",
]);

describe("API surface", () => {
  it("finds the whole route table", () => {
    expect(routes.length).toBeGreaterThan(140);
  });

  it("requires a signed-in user on every route except the explicit public list", () => {
    const open = routes.filter((r) => !r.secured && !PUBLIC.has(id(r))).map(id);
    expect(open).toEqual([]);
  });

  it("the public list contains only routes that exist", () => {
    const have = new Set(routes.map(id));
    for (const p of PUBLIC) expect(have.has(p), p).toBe(true);
  });

  it("every other signed-in route declares a permission", () => {
    const missing = routes
      .filter(
        (r) =>
          r.secured && r.permissions.length === 0 && !SELF_SCOPED.has(id(r)),
      )
      .map(id);
    expect(missing).toEqual([]);
  });

  it("produces a valid-looking OpenAPI document with schemas for bodies", () => {
    const doc = buildOpenApi(app);
    expect(doc.openapi).toBe("3.0.3");
    const create = doc.paths["/api/v1/vehicles"].post;
    expect(create["x-permissions"]).toEqual(["vehicles:write"]);
    expect(
      create.requestBody.content["application/json"].schema.properties
        .registrationNumber,
    ).toBeTruthy();
    expect(
      doc.paths["/api/v1/driver/trips/{id}/start"].post["x-permissions"],
    ).toEqual(["trips:operate"]);
  });
});
