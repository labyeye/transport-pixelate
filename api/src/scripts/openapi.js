// Builds an OpenAPI 3 document from the real Express route table. Validation schemas, permission checks and
// "needs a signed-in user" are read from metadata attached by the middleware, so the document cannot drift.
import { z } from "zod";
import { protect } from "../middleware/auth.js";

const PUBLIC = new Map([
  ["POST /api/v1/auth/register", "Creates an organization and its first owner"],
  ["POST /api/v1/auth/login", "Rate limited; locks after repeated failures"],
  ["POST /api/v1/auth/refresh", "Exchanges a refresh token"],
  ["POST /api/v1/auth/forgot-password", "Always answers the same way"],
  ["POST /api/v1/auth/reset-password", "Single-use emailed token"],
  ["GET /api/v1/health", "Liveness/readiness"],
]);
const DEVICE = "POST /api/v1/tracking/ingest";
const WEBHOOK = "POST /api/v1/billing/razorpay/webhook";

function mountPath(layer) {
  if (layer.regexp?.fast_slash) return "";
  return layer.regexp.source
    .replace("\\/?(?=\\/|$)", "")
    .replace(/^\^/, "")
    .replace(/\\\//g, "/")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, "{param}");
}
const toOpenApiPath = (p) =>
  p
    .replace(/:([A-Za-z_]\w*)/g, "{$1}")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";

function jsonSchema(schema) {
  try {
    return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  } catch {
    return { type: "object" };
  }
}

function walk(stack, prefix, secured, out, inherited = []) {
  let isSecured = secured;
  let inheritedPerms = inherited;
  for (const layer of stack) {
    if (layer.route) {
      const fns = layer.route.stack.map((l) => l.handle);
      const own = fns.some((f) => f === protect);
      const metas = fns.map((f) => f.meta).filter(Boolean);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          path: toOpenApiPath(prefix + layer.route.path),
          secured: isSecured || own,
          permissions: [
            ...inheritedPerms,
            ...metas
              .filter((m) => m.kind === "permission")
              .flatMap((m) => m.permissions),
          ],
          validators: metas.filter((m) => m.kind === "validate"),
        });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      walk(
        layer.handle.stack,
        prefix + mountPath(layer),
        isSecured,
        out,
        inheritedPerms,
      );
    } else if (layer.handle === protect) {
      isSecured = true; // router.use(protect) secures every route registered after it
    } else if (layer.handle?.meta?.kind === "permission") {
      inheritedPerms = [...inheritedPerms, ...layer.handle.meta.permissions]; // router.use(requirePermission(..))
    }
  }
}

export function collectRoutes(app) {
  const out = [];
  walk(app._router.stack, "", false, out);
  return out;
}

export function buildOpenApi(app) {
  const routes = collectRoutes(app).filter((r) => r.path.startsWith("/api/v1"));
  const paths = {};
  for (const r of routes) {
    const key = `${r.method} ${r.path.replace(/\{(\w+)\}/g, ":$1")}`;
    const tag = r.path.split("/")[3] ?? "root";
    const op = {
      tags: [tag],
      summary: `${r.method} ${r.path.replace("/api/v1", "")}`,
      parameters: [
        ...(r.path.match(/\{(\w+)\}/g) ?? []).map((p) => ({
          name: p.slice(1, -1),
          in: "path",
          required: true,
          schema: { type: "string" },
        })),
      ],
      responses: {
        200: { description: "OK" },
        400: { description: "Validation failed" },
        404: { description: "Not found" },
      },
    };
    for (const v of r.validators) {
      const js = jsonSchema(v.schema);
      if (v.source === "body")
        op.requestBody = {
          required: true,
          content: { "application/json": { schema: js } },
        };
      else if (v.source === "query") {
        for (const [name, s] of Object.entries(js.properties ?? {}))
          op.parameters.push({
            name,
            in: "query",
            required: (js.required ?? []).includes(name),
            schema: s,
          });
      }
    }
    if (r.secured) {
      op.security = [{ bearerAuth: [] }];
      op.responses[401] = { description: "Not signed in" };
      if (r.permissions.length) {
        op.responses[403] = { description: "Missing permission" };
        op["x-permissions"] = r.permissions;
      }
    } else if (`${r.method} ${r.path}` === DEVICE) {
      op.security = [{ deviceKey: [] }];
      op.description =
        "Authenticated by `Authorization: Device <publicId>:<apiKey>`.";
    } else if (`${r.method} ${r.path}` === WEBHOOK) {
      op.security = [];
      op.description =
        "Authenticated by the X-Razorpay-Signature HMAC over the raw request body.";
    } else {
      op.security = [];
      op.description = PUBLIC.get(`${r.method} ${r.path}`);
      op["x-public"] = true;
    }
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
    void key;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Nest Transport API",
      version: "1.0.0",
      description:
        "Generated from the live route table. Money in billing endpoints is in integer minor units (paise).",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        deviceKey: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "Device <publicId>:<apiKey>",
        },
      },
    },
    paths,
  };
}

export function buildMarkdown(doc) {
  const rows = [];
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const auth = op["x-public"]
        ? "public"
        : op.security?.[0]?.deviceKey
          ? "device key"
          : op.security?.length === 0
            ? "signature"
            : "signed in";
      rows.push({
        tag: op.tags[0],
        method: method.toUpperCase(),
        path,
        auth,
        perms: (op["x-permissions"] ?? []).join(", "),
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.tag.localeCompare(b.tag) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method),
  );
  let md =
    "# API reference\n\nGenerated by `npm run docs:api` from the live route table. Machine-readable version: `docs/openapi.json`.\n";
  md +=
    "\nAll paths are under the same origin as the API; responses are `{ success, data, meta?, message?, errors? }`.\n";
  let tag = "";
  for (const r of rows) {
    if (r.tag !== tag) {
      tag = r.tag;
      md += `\n## ${tag}\n\n| Method | Path | Access | Permissions |\n|---|---|---|---|\n`;
    }
    md += `| ${r.method} | \`${r.path}\` | ${r.auth} | ${r.perms || "—"} |\n`;
  }
  return md;
}
