import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "../app.js";
import { buildMarkdown, buildOpenApi } from "./openapi.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../docs");
fs.mkdirSync(out, { recursive: true });
const doc = buildOpenApi(createApp(["http://localhost"]));
fs.writeFileSync(path.join(out, "openapi.json"), JSON.stringify(doc, null, 2));
fs.writeFileSync(path.join(out, "API.md"), buildMarkdown(doc));
console.log(
  `Wrote ${Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations to docs/openapi.json and docs/API.md`,
);
